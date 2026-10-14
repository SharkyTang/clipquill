#!/usr/bin/env python3
"""One-time, per-user installation of the self-contained macOS helper bundle."""
import argparse
import base64
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shlex
import shutil
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request

HOST_NAME = 'com.clipquill.local_helper'
EXTENSION_PATH = Path('outputs/douyin-independent-extension')


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def safe_path(root, relative):
    value = PurePosixPath(relative)
    if value.is_absolute() or not value.parts or any(part in ('.', '..') for part in value.parts):
        raise ValueError('安装清单包含无效的路径。')
    path = root.joinpath(*value.parts)
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('安装路径指向目录之外。')
    return path


def extension_id(directory):
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    # Unpacked Chrome extensions derive their ID from the normalized absolute
    # path unless a public manifest key is present. Never read browser profiles.
    data = base64.b64decode(manifest['key'], validate=True) if manifest.get('key') else str(directory.resolve()).encode('utf-8')
    return ''.join(chr(97 + int(value, 16)) for value in hashlib.sha256(data).hexdigest()[:32])


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def checked_copy(source, destination, entry):
    if source.is_symlink() or not source.is_file() or source.stat().st_size != entry['bytes'] or digest(source) != entry['sha256']:
        raise ValueError('安装包文件不完整：' + entry['path'])
    if destination.is_file() and not destination.is_symlink() and destination.stat().st_size == entry['bytes'] and digest(destination) == entry['sha256']:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + '.installing')
    shutil.copyfile(source, temporary)
    temporary.chmod(entry.get('mode', 0o644))
    temporary.replace(destination)


def verified(path, entry):
    return (path.is_file() and not path.is_symlink() and path.stat().st_size == entry['bytes']
            and digest(path) == entry['sha256'])


def ssl_context():
    # The portable Python bundle uses the macOS certificate store, so installing
    # Python certificates or changing the user's shell environment is unnecessary.
    try:
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except ImportError:
        return ssl.create_default_context()


def download_model(entry, destination, opener=None, sleep=time.sleep):
    url = entry['url']
    if not re.fullmatch(r'https://huggingface\.co/[\w.-]+/[\w.-]+/resolve/[0-9a-f]{40}/[^?#]+', url):
        raise ValueError('模型下载地址不是已固定版本的官方来源。')
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + '.part')
    open_url = opener or urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context())).open
    for attempt in range(3):
        offset = partial.stat().st_size if partial.is_file() else 0
        if offset > entry['bytes']:
            partial.unlink()
            offset = 0
        if offset == entry['bytes']:
            if verified(partial, entry):
                partial.replace(destination)
                return
            partial.unlink()
            offset = 0
        request = urllib.request.Request(url, headers={'User-Agent': 'ClipQuill-Installer/0.1.5', **({'Range': 'bytes=' + str(offset) + '-'} if offset else {})})
        try:
            with open_url(request, timeout=30) as reply:
                if offset and reply.status == 206:
                    if not reply.headers.get('Content-Range', '').startswith('bytes ' + str(offset) + '-'):
                        raise ValueError('模型断点续传响应不匹配。')
                    mode = 'ab'
                elif reply.status == 200:
                    offset, mode = 0, 'wb'
                else:
                    raise ValueError('模型下载响应不支持。')
                total, last_report = offset, 0.0
                with partial.open(mode) as output:
                    while True:
                        block = reply.read(1024 * 1024)
                        if not block:
                            break
                        total += len(block)
                        if total > entry['bytes']:
                            raise ValueError('模型下载超出预期大小。')
                        output.write(block)
                        if time.monotonic() - last_report > 2:
                            print('  ' + destination.name + '：' + str(round(100 * total / entry['bytes'])) + '%', flush=True)
                            last_report = time.monotonic()
            if not verified(partial, entry):
                partial.unlink(missing_ok=True)
                raise ValueError('模型校验失败，正在重新下载。')
            partial.replace(destination)
            return
        except (OSError, urllib.error.URLError, ValueError) as exc:
            if attempt == 2:
                raise RuntimeError('模型下载未完成，重新运行首次安装会继续：' + str(exc)) from exc
            print('  下载中断，正在重试…', flush=True)
            sleep(1 + attempt)


def prepare_models(target, entries, seed=None):
    for index, entry in enumerate(entries, 1):
        relative = Path(entry['path'])
        if relative.parts[:2] != ('work', 'independent-asr'):
            raise ValueError('模型安装路径无效。')
        destination = safe_path(target, entry['path'])
        print('准备模型文件 ' + str(index) + '/' + str(len(entries)) + '：' + relative.name, flush=True)
        if verified(destination, entry):
            continue
        source = safe_path(seed, entry['path']) if seed else None
        if source and verified(source, entry):
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(destination.name + '.installing')
            # APFS clones keep a local upgrade fast without linking the installed
            # helper's models to the original project directory.
            result = subprocess.run(['/bin/cp', '-c', str(source), str(temporary)], capture_output=True)
            if result.returncode:
                shutil.copyfile(source, temporary)
            temporary.replace(destination)
        else:
            download_model(entry, destination)


def register_host(target, extensions, host_directory):
    if not extensions or not all(re.fullmatch(r'[a-p]{32}', value) for value in extensions):
        raise ValueError('扩展连接配置无效。')
    extensions = list(dict.fromkeys(extensions))
    atomic_json(target / 'work/native-host.json', {'protocol': 1, 'extensions': extensions})
    launcher = target / 'scripts/native-host.command'
    launcher.write_text('#!/bin/sh\nexec ' + shlex.quote(str(target / 'runtime/bin/python3.12')) +
                        ' -u -B ' + shlex.quote(str(target / 'scripts/native_host.py')) + ' "$@"\n', encoding='utf-8')
    launcher.chmod(0o755)
    host_directory.mkdir(parents=True, exist_ok=True)
    atomic_json(host_directory / (HOST_NAME + '.json'), {
        'name': HOST_NAME, 'description': 'ClipQuill local transcription helper',
        'path': str(launcher), 'type': 'stdio',
        'allowed_origins': ['chrome-extension://' + value + '/' for value in extensions]
    })


def migrate_results(source, target):
    for relative in ('work/transcription-jobs', 'outputs/extension-transcripts'):
        directory = source / relative
        if not directory.is_dir() or directory.is_symlink():
            continue
        for path in directory.rglob('*'):
            if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(directory.resolve()):
                continue
            if relative == 'work/transcription-jobs' and path.suffix != '.json':
                continue
            destination = safe_path(target, str(path.relative_to(source)))
            if destination.exists():
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            result = subprocess.run(['/bin/cp', '-c', str(path), str(destination)], capture_output=True)
            if result.returncode:
                shutil.copyfile(path, destination)


def install(package, target, host_directory, seed=None, existing_extension=None, existing_project=None):
    manifest = json.loads((package / 'bundle.json').read_text(encoding='utf-8'))
    if manifest.get('app') != 'ClipQuill' or manifest.get('protocol') != 1:
        raise ValueError('请使用完整的 ClipQuill 安装包。')
    if target.is_symlink():
        raise ValueError('安装目录不能是替身或符号链接。')
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    target.chmod(0o700)
    payload = package / 'payload'
    (target / 'work').mkdir(exist_ok=True)
    with (target / 'work/install.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('另一个安装窗口正在准备环境，请等它完成。')
        print('1/4 安装本地运行环境和音频工具…', flush=True)
        for entry in manifest['files']:
            checked_copy(safe_path(payload, entry['path']), safe_path(target, entry['path']), entry)
        python = target / 'runtime/bin/python3.12'
        subprocess.run([str(python), '-m', 'venv', '--without-pip', '--system-site-packages', str(target / 'work/asr-venv')], check=True)
        print('2/4 准备识别模型。首次下载约 4.0 GiB；中断后重新安装可继续…', flush=True)
        prepare_models(target, manifest['models'], seed)
        print('3/4 检查运行环境…', flush=True)
        env = {key: value for key, value in os.environ.items() if key not in ('PYTHONPATH', 'PYTHONHOME', 'DYLD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES')}
        env.update(PATH=str(target / 'bin') + ':/usr/bin:/bin:/usr/sbin:/sbin', PYTHONNOUSERSITE='1', HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
        subprocess.run([str(target / 'work/asr-venv/bin/python'), '-B', '-c',
                        'import sys; sys.path.insert(0, ' + repr(str(target / 'scripts')) + '); '
                        'import mlx.core, numpy; from mlx_audio.stt import load; '
                        'from transcription_bridge import runtime_ready; assert runtime_ready(), "runtime incomplete"'],
                       env=env, check=True, timeout=60)
        for name in ('ffmpeg', 'ffprobe'):
            subprocess.run([str(target / 'bin' / name), '-version'], env=env, check=True, capture_output=True, timeout=15)
        subprocess.run([str(target / 'work/independent-asr/build/bin/whisper-cli'), '--help'], env=env,
                       check=True, capture_output=True, timeout=15)
        if existing_project and existing_project.resolve() != target.resolve():
            migrate_results(existing_project, target)
        print('4/4 自动连接 Chrome 扩展…', flush=True)
        extensions = [extension_id(target / EXTENSION_PATH)]
        if existing_extension:
            extensions.append(extension_id(existing_extension))
        previous = target / 'work/native-host.json'
        if previous.is_file():
            old = json.loads(previous.read_text(encoding='utf-8')).get('extensions', [])
            extensions += [value for value in old if isinstance(value, str) and re.fullmatch(r'[a-p]{32}', value)]
        register_host(target, list(dict.fromkeys(extensions))[:8], host_directory)
        atomic_json(target / 'installation.json', {'app': 'ClipQuill', 'version': manifest['version'], 'protocol': 1, 'installedAt': time.time()})
    print('安装完成。以后点击“提取文案”即可自动启动本地助手。', flush=True)
    print('Chrome 扩展目录：' + str(target / EXTENSION_PATH), flush=True)
    return target / EXTENSION_PATH


def main():
    parser = argparse.ArgumentParser(description='安装一次 ClipQuill 本地助手，以后自动启动')
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--target', type=Path, default=Path.home() / 'Library/Application Support/ClipQuill')
    parser.add_argument('--host-directory', type=Path, default=Path.home() / 'Library/Application Support/Google/Chrome/NativeMessagingHosts')
    parser.add_argument('--seed-models', type=Path)
    parser.add_argument('--existing-extension', type=Path)
    parser.add_argument('--existing-project', type=Path)
    parser.add_argument('--no-open', action='store_true')
    args = parser.parse_args()
    try:
        metadata = json.loads((args.package / 'bundle.json').read_text(encoding='utf-8'))
        if sys.platform != 'darwin' or platform.machine() != 'arm64':
            raise RuntimeError('此安装包适用于 Apple Silicon Mac；其他平台的安装包尚未提供。')
        if tuple(map(int, platform.mac_ver()[0].split('.'))) < tuple(map(int, metadata['minimum_macos'].split('.'))):
            raise RuntimeError('此安装包需要 macOS ' + metadata['minimum_macos'] + ' 或更新版本。')
        directory = install(args.package.resolve(), args.target.absolute(), args.host_directory.absolute(),
                            args.seed_models, args.existing_extension, args.existing_project)
        if not args.no_open:
            subprocess.run(['/usr/bin/open', str(directory)], check=False)
            subprocess.run(['/usr/bin/open', '-a', 'Google Chrome', 'chrome://extensions'], check=False)
            print('首次加载：Chrome 开启“开发者模式” → “加载已解压的扩展程序” → 选择刚打开的目录。')
            print('已安装旧版时，重新加载原来的扩展，不要卸载，以保留草稿。')
    except Exception as exc:
        print('安装未完成：' + str(exc) + '\n请重新双击首次安装继续。已下载完成的模型会保留。', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
