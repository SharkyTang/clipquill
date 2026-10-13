#!/usr/bin/env python3
"""Offline transcription of a local media file; never contacts Qingdou or an API."""
import argparse
import collections
import hashlib
import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASR = ROOT / "work" / "independent-asr"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description="本地视频/音频 → 原始文稿、SRT、JSON；不联网")
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", required=True, type=Path, help="新建结果目录，已有目录不会覆盖")
    parser.add_argument("--model", type=Path, default=ASR / "ggml-large-v3-turbo-q5_0.bin")
    parser.add_argument("--vad-model", type=Path, default=ASR / "ggml-silero-v6.2.0.bin")
    parser.add_argument("--no-vad", action="store_true", help="关闭语音片段检测，仅用于对照")
    parser.add_argument("--binary", type=Path, default=ASR / "build/bin/whisper-cli")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--seconds", type=float, help="仅处理开头指定秒数；省略则处理全片")
    parser.add_argument("--terms", default="", help="可选术语提示，不代表识别准确性保证")
    parser.add_argument("--gpu", action="store_true", help="尝试 Metal GPU，默认使用 CPU")
    args = parser.parse_args()
    for path in (args.input, args.model, args.binary):
        if not path.is_file():
            parser.error("文件不存在：" + str(path))
    if not args.no_vad and not args.vad_model.is_file():
        parser.error("语音检测模型不存在：" + str(args.vad_model))
    if args.seconds is not None and args.seconds <= 0:
        parser.error("--seconds 必须大于 0")
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            parser.error("缺少工具：" + tool)
    if args.output.exists():
        parser.error("输出目录已存在，请选一个新目录")
    args.output.mkdir(parents=True)
    output = args.output.resolve()
    started = time.monotonic()
    manifest = {
        "status": "running",
        "input": str(args.input.resolve()),
        "input_sha256": sha256(args.input),
        "model": str(args.model.resolve()),
        "model_sha256": sha256(args.model),
        "language": args.language,
        "duration_limit_seconds": args.seconds,
        "terms_hint": args.terms,
        "vad_enabled": not args.no_vad,
        "vad_model": str(args.vad_model.resolve()) if not args.no_vad else None,
        "device_requested": "gpu" if args.gpu else "cpu",
        "network_used_by_wrapper": False,
        "transcript_kind": "raw_asr_unreviewed",
    }
    try:
        with tempfile.TemporaryDirectory(prefix="audio-", dir=str(output)) as temp:
            wav = Path(temp) / "audio.wav"
            convert = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
                       "-protocol_whitelist", "file,pipe",
                       "-i", str(args.input.resolve())]
            if args.seconds is not None:
                convert += ["-t", str(args.seconds)]
            convert += ["-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(wav)]
            with (output / "processing.log").open("w") as log:
                subprocess.run(convert, check=True, stdout=log, stderr=log, timeout=600)
                metadata = subprocess.check_output([
                    "ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name,sample_rate,channels",
                    "-of", "json", str(wav)], timeout=30, text=True)
                manifest["audio"] = json.loads(metadata)
                command = [str(args.binary.resolve()), "--model", str(args.model.resolve()),
                           "--file", str(wav), "--language", args.language, "--threads", "4",
                           "--output-txt", "--output-srt", "--output-json-full", "--max-len", "90",
                           "--output-file", str(output / "transcript")]
                if not args.gpu:
                    command.append("--no-gpu")
                if args.terms:
                    command += ["--prompt", args.terms, "--carry-initial-prompt"]
                if not args.no_vad:
                    command += ["--vad", "--vad-model", str(args.vad_model.resolve()),
                                "--vad-speech-pad-ms", "200", "--vad-min-silence-duration-ms", "300"]
                inference_started = time.monotonic()
                subprocess.run(command, check=True, stdout=log, stderr=log, timeout=7200)
                manifest["inference_seconds"] = round(time.monotonic() - inference_started, 3)
                # An audio-only review copy stays local alongside the untouched ASR output.
                subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
                                "-i", str(wav), "-c:a", "aac", "-b:a", "64k",
                                str(output / "review.m4a")], check=True, stdout=log, stderr=log, timeout=600)
            for ext in ("txt", "srt", "json"):
                if not (output / ("transcript." + ext)).is_file():
                    raise RuntimeError("识别引擎未产生完整输出")
            result = json.loads((output / "transcript.json").read_text())
            segments = result.get("transcription", [])
            if not segments:
                raise RuntimeError("没有识别到有效语音；请检查音轨")
            manifest["segments"] = len(segments)
            review = []
            for i, segment in enumerate(segments):
                tokens = [t for t in segment.get("tokens", []) if t.get("text", "").strip()
                          and not t.get("text", "").startswith("[_")]
                # This is a review cue, never a calibrated accuracy percentage.
                uncertain = any(t.get("p", 1) < 0.5 for t in tokens)
                review.append({"id": i, "startMs": segment["offsets"]["from"],
                               "endMs": segment["offsets"]["to"], "text": segment["text"].strip(),
                               "needsAttention": uncertain})
            (output / "review.json").write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n")
            manifest["text_characters"] = len((output / "transcript.txt").read_text().strip())
            repeats = collections.Counter(s.get("text", "").strip() for s in segments)
            manifest["quality_warnings"] = [
                "同一文本重复至少 10 次，可能是识别幻觉；请听音频复核"
            ] if any(text and count >= 10 for text, count in repeats.items()) else []
            manifest["status"] = "completed_unreviewed"
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        manifest["status"] = "failed"
        manifest["error"] = str(exc)
    finally:
        manifest["elapsed_seconds"] = round(time.monotonic() - started, 3)
        (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": manifest["status"], "output": str(output)}, ensure_ascii=False))
    return 0 if manifest["status"] == "completed_unreviewed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
