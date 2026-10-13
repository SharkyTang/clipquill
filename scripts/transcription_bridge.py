#!/usr/bin/env python3
"""Loopback-only companion for the installed extension and offline whisper.cpp."""
import argparse
import json
import os
import re
import shutil
import signal
import stat
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASR = ROOT / 'work/independent-asr'
DEFAULT_EXTENSION = 'plkcgmcflhibmbhlkfflfblbpencggek'
MAX_BYTES = 2 * 1024 ** 3


class RequestError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def validate_source(payload, download_root):
    if not isinstance(payload, dict):
        raise RequestError('请求格式不正确。')
    work_id = payload.get('workId', '')
    if not isinstance(work_id, str) or not re.fullmatch(r'\d{10,30}', work_id):
        raise RequestError('作品 ID 无效。')
    size = payload.get('expectedBytes')
    if type(size) is not int or not 0 < size <= MAX_BYTES:
        raise RequestError('文件大小无效。')
    duration = payload.get('durationMs')
    if type(duration) not in (int, float) or not 0 < duration <= 3600000:
        raise RequestError('本地原型支持一小时以内的视频。')
    value = payload.get('path')
    if not isinstance(value, str) or len(value) > 4096 or '\x00' in value:
        raise RequestError('文件路径无效。')
    path = Path(value)
    root = download_root.resolve()
    # The API never accepts arbitrary local files, URLs or symlink targets.
    if not path.is_absolute() or path.parent != root or path.is_symlink():
        raise RequestError('仅处理“下载 / 抖音独立导出”中的视频。')
    if not re.fullmatch(re.escape(work_id) + r'_\d{2,4}p_.+\.mp4', path.name):
        raise RequestError('下载文件名与作品不一致。')
    try:
        info = path.stat()
    except OSError:
        raise RequestError('下载文件不存在，请重新下载。')
    if not stat.S_ISREG(info.st_mode) or info.st_size != size:
        raise RequestError('下载文件不完整或大小不一致。')
    return path, work_id, size, duration


def runtime_ready():
    required = [ROOT / 'work/asr-venv/bin/python', ASR / 'qwen3-asr-1.7b-8bit/model.safetensors',
                ASR / 'qwen3-aligner-0.6b-8bit/model.safetensors', ASR/'build/bin/whisper-cli',
                ASR/'ggml-large-v3-turbo-q5_0.bin', ASR/'ggml-silero-v6.2.0.bin']
    return all(p.is_file() for p in required) and all(shutil.which(t) for t in ('ffmpeg', 'ffprobe'))


class Jobs:
    def __init__(self, download_root, work_root, output_root):
        self.download_root, self.work_root, self.output_root = download_root, work_root, output_root
        self.lock = threading.Lock()
        self.active = None
        self.process = None
        self.stopping = False
        self.states = {}
        work_root.mkdir(parents=True, exist_ok=True)
        output_root.mkdir(parents=True, exist_ok=True)

    def save(self, job):
        with self.lock:
            self.states[job['id']] = dict(job)
            path = self.work_root / (job['id'] + '.json')
            temp = path.with_suffix('.tmp')
            temp.write_text(json.dumps(job, ensure_ascii=False), encoding='utf-8')
            temp.replace(path)

    def start(self, payload):
        source, work_id, size, duration = validate_source(payload, self.download_root)
        terms = payload.get('terms', '')
        if not isinstance(terms, str) or len(terms) > 400 or '\x00' in terms:
            raise RequestError('术语提示应为 400 字以内的文字。')
        if not runtime_ready():
            raise RequestError('本地语音模型或 FFmpeg 尚未准备好。', 503)
        with self.lock:
            if self.active or self.stopping:
                raise RequestError('已有文案任务正在处理，请等待完成。', 409)
            job_id = uuid.uuid4().hex
            self.active = job_id
        job = {'id': job_id, 'workId': work_id, 'title': str(payload.get('title', ''))[:600],
               'status': 'running', 'stage': '准备音频', 'startedAt': time.time(), 'terms': terms,
               'model': 'Qwen3-ASR 1.7B · 中文精校'}
        self.save(job)
        threading.Thread(target=self.run, args=(job, source, size, duration), daemon=True).start()
        return job

    def command(self, args, timeout, log_path=None):
        with self.lock:
            if self.stopping:
                raise RequestError('本地服务已停止。')
            process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, start_new_session=True)
            self.process = process
        try:
            stdout, stderr = process.communicate(timeout=timeout)
            if log_path is not None and log_path.parent.is_dir():
                log_path.write_text(stdout + '\n' + stderr, encoding='utf-8')
            if process.returncode:
                raise RequestError('本地识别失败；请查看任务输出目录中的处理日志。')
            return stdout
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            process.communicate()
            raise RequestError('本地处理超时，请尝试较短的视频。')
        finally:
            with self.lock:
                self.process = None

    def run(self, job, source, size, duration):
        snapshot = self.work_root / (job['id'] + '.mp4')
        output = self.output_root / (job['workId'] + '-' + job['id'])
        try:
            # Snapshot the verified file so later replacement cannot change input.
            fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as incoming, snapshot.open('xb') as destination:
                info = os.fstat(incoming.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size != size:
                    raise RequestError('下载文件已变化，请重试。')
                remaining = size
                while remaining:
                    block = incoming.read(min(1024 * 1024, remaining))
                    if not block:
                        raise RequestError('下载文件不完整。')
                    destination.write(block)
                    remaining -= len(block)
            metadata = json.loads(self.command(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', str(snapshot)], 30))
            seconds = float(metadata.get('format', {}).get('duration', 0))
            if not 0 < seconds <= 3600 or abs(seconds - duration / 1000) > 2:
                raise RequestError('实际视频时长与作品数据不一致。')
            if not any(s.get('codec_type') == 'audio' for s in metadata.get('streams', [])):
                raise RequestError('这条视频没有可识别的音轨。')
            job.update(stage='中文模型识别与逐句时间对齐', durationSeconds=seconds)
            self.save(job)
            self.command([str(ROOT / 'work/asr-venv/bin/python'), '-B', str(ROOT / 'scripts/transcribe_accurate.py'), str(snapshot),
                          '--output', str(output), '--terms', job['terms']], 7800, output / 'processing.log')
            manifest = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
            if manifest.get('status') != 'completed_unreviewed':
                raise RequestError('识别没有完整完成，请查看本地处理日志。')
            job.update(status='complete', stage='完成', finishedAt=time.time(),
                text=(output / 'transcript.txt').read_text(encoding='utf-8').strip(),
                srt=(output / 'transcript.srt').read_text(encoding='utf-8'),
                segments=manifest['segments'], characters=manifest['text_characters'],
                elapsedSeconds=manifest['elapsed_seconds'], inputSha256=manifest['input_sha256'],
                warnings=manifest['quality_warnings'], outputDirectory=str(output),
                reviewSegments=json.loads((output / 'review.json').read_text(encoding='utf-8')),
                hasAudio=True)
        except Exception as exc:
            job.update(status='failed', stage='失败', finishedAt=time.time(),
                       error=str(exc) if isinstance(exc, RequestError) else '本地处理失败，请检查模型和视频文件。')
        finally:
            # This is the service's own temporary copy, never the user's download.
            snapshot.unlink(missing_ok=True)
            self.save(job)
            with self.lock:
                self.active = None

    def get(self, job_id):
        if not re.fullmatch(r'[0-9a-f]{32}', job_id):
            raise RequestError('任务不存在。', 404)
        with self.lock:
            job = self.states.get(job_id)
        if job is None:
            path = self.work_root / (job_id + '.json')
            if not path.is_file():
                raise RequestError('任务不存在。', 404)
            job = json.loads(path.read_text(encoding='utf-8'))
            if job['status'] == 'running':
                job.update(status='failed', error='上次识别被服务重启中断，请重新提取。')
        return job

    def stop(self):
        with self.lock:
            self.stopping = True
            if self.process and self.process.poll() is None:
                os.killpg(self.process.pid, signal.SIGTERM)

    def audio(self, job_id):
        job = self.get(job_id)
        if job.get('status') != 'complete' or not job.get('hasAudio'):
            raise RequestError('此任务没有回听音频，请重新提取文案。', 404)
        # Derive the path from verified identifiers, never accept a supplied filename.
        path = self.output_root / (job['workId'] + '-' + job_id) / 'review.m4a'
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(self.output_root.resolve()):
            raise RequestError('回听音频不存在。', 404)
        if path.stat().st_size > 64 * 1024 ** 2:
            raise RequestError('回听音频过大。', 413)
        return path.read_bytes()


def make_handler(jobs, origin):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Do not log local filenames or recognized speech.

        def authorized(self):
            host = '127.0.0.1:' + str(self.server.server_port)
            if self.headers.get('Host') != host or self.headers.get('Origin') != origin:
                raise RequestError('此本地服务仅供已配置的扩展使用。', 403)

        def reply(self, status, value):
            body = json.dumps(value, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            if self.headers.get('Origin') == origin:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            try:
                self.authorized()
                self.send_response(204)
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Access-Control-Allow-Methods', 'GET, POST')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                self.send_header('Vary', 'Origin')
                self.end_headers()
            except RequestError as exc:
                self.reply(exc.status, {'error': str(exc)})

        def do_GET(self):
            try:
                self.authorized()
                if self.path == '/health':
                    self.reply(200, {'service': 'douyin-local-transcription', 'protocol': 1, 'ready': runtime_ready()})
                elif re.fullmatch(r'/jobs/[0-9a-f]{32}', self.path):
                    self.reply(200, jobs.get(self.path.split('/')[-1]))
                elif re.fullmatch(r'/jobs/[0-9a-f]{32}/audio', self.path):
                    body = jobs.audio(self.path.split('/')[2])
                    self.send_response(200)
                    self.send_header('Access-Control-Allow-Origin', origin)
                    self.send_header('Vary', 'Origin')
                    self.send_header('Content-Type', 'audio/mp4')
                    self.send_header('Cache-Control', 'no-store')
                    self.send_header('X-Content-Type-Options', 'nosniff')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    raise RequestError('接口不存在。', 404)
            except RequestError as exc:
                self.reply(exc.status, {'error': str(exc)})

        def do_POST(self):
            try:
                self.authorized()
                if self.path != '/jobs':
                    raise RequestError('接口不存在。', 404)
                if self.headers.get('Content-Type') != 'application/json':
                    raise RequestError('只接受 JSON 请求。', 415)
                if self.headers.get('Transfer-Encoding'):
                    raise RequestError('请求格式不支持。')
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                except ValueError:
                    raise RequestError('请求长度无效。')
                if not 0 < length <= 16384:
                    raise RequestError('请求过大或为空。', 413)
                self.connection.settimeout(10)
                try:
                    payload = json.loads(self.rfile.read(length))
                except (ValueError, OSError):
                    raise RequestError('请求内容无效。')
                self.reply(202, jobs.start(payload))
            except RequestError as exc:
                self.reply(exc.status, {'error': str(exc)})
    return Handler


def main():
    parser = argparse.ArgumentParser(description='启动抖音扩展的离线文案服务，只监听本机')
    parser.add_argument('--extension-id', default=DEFAULT_EXTENSION)
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-p]{32}', args.extension_id):
        parser.error('Chrome 扩展 ID 格式不正确')
    jobs = Jobs(Path.home() / 'Downloads/抖音独立导出', ROOT / 'work/transcription-jobs', ROOT / 'outputs/extension-transcripts')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(jobs, 'chrome-extension://' + args.extension_id))
    server.daemon_threads = True
    print('本地文案服务已启动，只监听 127.0.0.1:' + str(args.port) + '。关闭此窗口或按 Ctrl+C 可停止。', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        jobs.stop()
        server.server_close()


if __name__ == '__main__':
    main()
