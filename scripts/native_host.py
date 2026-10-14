#!/usr/bin/env python3
"""Chrome native host: one fixed command, no arbitrary shell/path/URL execution."""
import contextlib
import errno
import fcntl
import json
import os
from pathlib import Path
import re
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MAX_MESSAGE = 4096
HOST_NAME = 'com.clipquill.local_helper'


class StartupError(Exception):
    def __init__(self, message, code='STARTUP_FAILED'):
        super().__init__(message)
        self.code = code


def read_message(stream):
    header = stream.read(4)
    if len(header) != 4:
        raise StartupError('本地助手收到不完整的请求。', 'INVALID_MESSAGE')
    size = struct.unpack('=I', header)[0]
    if not 0 < size <= MAX_MESSAGE:
        raise StartupError('本地助手请求大小无效。', 'INVALID_MESSAGE')
    body = stream.read(size)
    if len(body) != size:
        raise StartupError('本地助手收到不完整的请求。', 'INVALID_MESSAGE')
    try:
        value = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise StartupError('本地助手请求格式无效。', 'INVALID_MESSAGE')
    if (not isinstance(value, dict) or type(value.get('protocol')) is not int or
            value != {'action': 'ensureService', 'protocol': 1}):
        raise StartupError('本地助手只接受启动文案服务的请求。', 'INVALID_MESSAGE')
    return value


def write_message(stream, value):
    body = json.dumps(value, ensure_ascii=False).encode('utf-8')
    stream.write(struct.pack('=I', len(body)) + body)
    stream.flush()


def paired_extensions(root):
    try:
        config = json.loads((root / 'work/native-host.json').read_text(encoding='utf-8'))
        extensions = config['extensions']
        if config.get('protocol') != 1 or not isinstance(extensions, list) or not extensions or len(extensions) > 8:
            raise ValueError()
        if not all(isinstance(value, str) and re.fullmatch(r'[a-p]{32}', value) for value in extensions):
            raise ValueError()
        return list(dict.fromkeys(extensions))
    except (OSError, ValueError, KeyError, TypeError):
        raise StartupError('本地助手安装未完成，请重新运行“首次安装.command”。', 'INSTALLATION_INCOMPLETE')


def authorized_origin(value, extensions):
    match = re.fullmatch(r'chrome-extension://([a-p]{32})/?', value)
    if not match or match[1] not in extensions:
        raise StartupError('此扩展尚未与本地助手配对，请重新运行首次安装。', 'UNPAIRED_EXTENSION')
    return 'chrome-extension://' + match[1]


def health(origin, port=8766):
    # Ignore system HTTP proxies: this request is strictly to the local loopback.
    request = urllib.request.Request('http://127.0.0.1:' + str(port) + '/health', headers={'Origin': origin})
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=1) as reply:
            value = json.loads(reply.read(16384))
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, OSError) and exc.reason.errno == errno.ECONNREFUSED:
            return None
        raise StartupError('本地端口已被占用或服务未响应，请关闭旧的手动服务后重试。', 'PORT_IN_USE')
    except (ValueError, socket.timeout, OSError):
        raise StartupError('本地端口没有响应匹配的文案服务，请重试。', 'PORT_IN_USE')
    if not isinstance(value, dict) or value.get('service') != 'douyin-local-transcription' or value.get('protocol') != 1:
        raise StartupError('本地端口被其他程序占用，请释放 8766 端口后重试。', 'PORT_IN_USE')
    if value.get('videoReuse') is not True:
        raise StartupError('旧服务需要更新，请关闭旧的手动服务后重试。', 'SERVICE_UPDATE_REQUIRED')
    if value.get('ready') is not True:
        raise StartupError('模型或音频工具尚未准备好，请重新运行首次安装。', 'RUNTIME_NOT_READY')
    return value


@contextlib.contextmanager
def startup_lock(root, timeout=25):
    work = root / 'work'
    work.mkdir(exist_ok=True)
    with (work / 'native-start.lock').open('a') as lock:
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise StartupError('另一个工具页正在启动服务，请稍后重试。', 'STARTUP_TIMEOUT')
                time.sleep(0.1)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def service_environment(root):
    env = {key: value for key, value in os.environ.items()
           if key not in ('PYTHONPATH', 'PYTHONHOME', 'DYLD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES')}
    env.update(PATH=str(root / 'bin') + ':/usr/bin:/bin:/usr/sbin:/sbin',
               PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1',
               HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
    return env


def ensure_service(root, origin, extensions, port=8766):
    with startup_lock(root):
        if health(origin, port):
            return {'ok': True, 'protocol': 1, 'reused': True}
        python = root / 'work/asr-venv/bin/python'
        bridge = root / 'scripts/transcription_bridge.py'
        if not python.is_file() or not bridge.is_file():
            raise StartupError('本地运行环境未安装完整，请重新运行首次安装。', 'INSTALLATION_INCOMPLETE')
        command = [str(python), '-u', '-B', str(bridge), '--port', str(port)]
        for extension in extensions:
            command += ['--extension-id', extension]
        log_path = root / 'work/native-service.log'
        if log_path.exists() and log_path.stat().st_size > 1024 ** 2:
            log_path.replace(log_path.with_suffix('.log.1'))
        with log_path.open('ab') as log:
            process = subprocess.Popen(command, cwd=root, env=service_environment(root),
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                       start_new_session=True, close_fds=True)
        (root / 'work/native-service.pid').write_text(str(process.pid), encoding='ascii')
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise StartupError('本地文案服务未能启动，请重试；仍失败时重新运行首次安装。')
            if health(origin, port):
                return {'ok': True, 'protocol': 1, 'reused': False}
            time.sleep(0.15)
        raise StartupError('本地文案服务启动超时，请重试启动。', 'STARTUP_TIMEOUT')


def main():
    try:
        extensions = paired_extensions(ROOT)
        origin = authorized_origin(sys.argv[1] if len(sys.argv) > 1 else '', extensions)
        read_message(sys.stdin.buffer)
        result = ensure_service(ROOT, origin, extensions)
    except StartupError as exc:
        result = {'ok': False, 'protocol': 1, 'error': str(exc), 'code': exc.code}
    except Exception:
        result = {'ok': False, 'protocol': 1, 'error': '本地助手启动失败，请重新运行首次安装修复。', 'code': 'STARTUP_FAILED'}
    write_message(sys.stdout.buffer, result)


if __name__ == '__main__':
    main()
