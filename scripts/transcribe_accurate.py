#!/usr/bin/env python3
"""Offline Qwen3-ASR and forced alignment, with optional vocabulary hints."""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import time
from pathlib import Path
from transcript_alignment import timed_segments, to_srt, flag_disagreements

ROOT = Path(__file__).resolve().parents[1]
ASR = ROOT / 'work/independent-asr'


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024*1024), b''):
            value.update(block)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser(description='本地中文识别与逐句时间对齐')
    parser.add_argument('input', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--terms', default='')
    args = parser.parse_args()
    if not args.input.is_file() or args.output.exists():
        parser.error('输入文件不存在，或输出目录已存在。')
    args.output.mkdir(parents=True)
    started = time.monotonic()
    manifest = dict(status='running', input_sha256=digest(args.input), model='Qwen3-ASR-1.7B-8bit',
                    alignment_model='Qwen3-ForcedAligner-0.6B-8bit', terms_hint=args.terms,
                    transcript_kind='raw_asr_unreviewed', network_used_by_wrapper=False,
                    quality_warnings=['自动识别及字幕时间均需核对；术语提示不保证对应词一定出现。'])
    try:
        import mlx.core as mx
        import numpy as np
        from mlx_audio.stt import load
        from mlx_audio.stt.utils import load_audio
        with tempfile.TemporaryDirectory(prefix='audio-', dir=args.output) as temporary:
            wav = Path(temporary) / 'audio.wav'
            subprocess.run(['ffmpeg','-nostdin','-v','error','-n','-protocol_whitelist','file,pipe',
                            '-i',str(args.input.resolve()),'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',str(wav)],check=True,timeout=600)
            audio = np.array(load_audio(str(wav)))
            duration = len(audio)/16000
            if not 0 < duration <= 3600:
                raise ValueError('音频时长须在一小时内。')
            manifest['duration_seconds'] = duration
            model_path = ASR / 'qwen3-asr-1.7b-8bit'
            model = load(str(model_path))
            terms = [term.strip() for term in re.split(r'[,，、;；\n]', args.terms) if term.strip()]
            result = model.generate(audio, language='Chinese', hotwords=terms or None, chunk_duration=30,
                                    max_tokens=32768, temperature=0.0, verbose=True)
            chunks = result.segments
            if not chunks or chunks[-1]['end'] < duration - 0.2 or result.generation_tokens >= 32768:
                raise ValueError('识别未覆盖完整音频，不能作为完成结果；请缩短视频后重试。')
            (args.output/'recognition.json').write_text(json.dumps({'text':result.text,'chunks':chunks}, ensure_ascii=False,indent=2))
            del model
            mx.clear_cache()
            aligner = load(str(ASR / 'qwen3-aligner-0.6b-8bit'))
            segments, all_words = [], []
            for chunk in chunks:
                text = chunk['text'].strip()
                if not text:
                    continue
                start, end = float(chunk['start']), min(duration, float(chunk['end']))
                aligned = aligner.generate(audio[int(round(start*16000)):int(round(end*16000))], text=text, language='Chinese')
                words = [{'text':w.text,'start':w.start_time,'end':w.end_time} for w in aligned.items]
                all_words.append({'offset':start,'words':words})
                segments.extend(timed_segments(text, words, start, end))
            if not segments:
                raise ValueError('未识别到有效语音。')
            # Independent acoustic recognition only flags disagreements. No text rewriting.
            compare = [str(ASR/'build/bin/whisper-cli'), '--model', str(ASR/'ggml-large-v3-turbo-q5_0.bin'),
                       '--file',str(wav),'--language','zh','--threads','4','--output-json',
                       '--output-file',str(args.output/'comparison'), '--vad', '--vad-model',str(ASR/'ggml-silero-v6.2.0.bin')]
            if args.terms:
                compare += ['--prompt', args.terms, '--carry-initial-prompt']
            with (args.output/'comparison.log').open('w') as log:
                subprocess.run(compare, stdout=log, stderr=log, check=True, timeout=7200)
            reference = json.loads((args.output/'comparison.json').read_text())
            flag_disagreements(segments, ''.join(s['text'] for s in reference['transcription']))
            for i, segment in enumerate(segments):
                segment['id'] = i
            text = '\n'.join(s['text'] for s in segments)
            (args.output/'transcript.txt').write_text(text+'\n')
            (args.output/'transcript.srt').write_text(to_srt(segments))
            (args.output/'review.json').write_text(json.dumps(segments,ensure_ascii=False,indent=2)+'\n')
            (args.output/'alignment.json').write_text(json.dumps(all_words,ensure_ascii=False)+'\n')
            subprocess.run(['ffmpeg','-nostdin','-v','error','-n','-i',str(wav),'-c:a','aac','-b:a','64k',str(args.output/'review.m4a')],check=True,timeout=600)
            manifest.update(status='completed_unreviewed', segments=len(segments), text_characters=len(text),
                            comparison_model='Whisper large-v3-turbo-q5_0',
                            attention_segments=sum(bool(s['needsAttention']) for s in segments))
    except Exception as exc:
        manifest.update(status='failed', error=str(exc))
        raise
    finally:
        manifest['elapsed_seconds'] = round(time.monotonic()-started,3)
        (args.output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':manifest['status'],'output':str(args.output)},ensure_ascii=False))


if __name__ == '__main__':
    main()
