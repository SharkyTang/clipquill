#!/usr/bin/env python3
"""Build the macOS installer using verified local runtimes; no user build tools."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.1.5'


def verify_bundle(output):
    payload = output / 'payload'
    env = {**os.environ, 'PATH': '/usr/bin:/bin', 'PYTHONNOUSERSITE': '1'}
    env.pop('PYTHONPATH', None)
    subprocess.run([str(payload / 'runtime/bin/python3.12'), '-B', '-c',
                    'import mlx.core, numpy; from mlx_audio.stt import load; print("Portable ASR imports ready")'], env=env, check=True)
    for name in ('ffmpeg', 'ffprobe'):
        subprocess.run([str(payload / 'bin' / name), '-version'], env=env, check=True, capture_output=True)
    subprocess.run([str(payload / 'work/independent-asr/build/bin/whisper-cli'), '--help'], env=env, check=True, capture_output=True)
    print('Portable Python and audio tools ready with system-only PATH.', flush=True)


def refresh_sources(output):
    metadata = json.loads((output / 'bundle.json').read_text())
    if metadata.get('app') != 'ClipQuill':
        raise RuntimeError('Not a ClipQuill bundle')
    payload = output / 'payload'
    for name in ('native_host.py', 'transcription_bridge.py', 'transcribe_accurate.py', 'transcript_alignment.py', 'install_helper.py', 'asr-requirements.lock.txt'):
        shutil.copy2(ROOT / 'scripts' / name, payload / 'scripts' / name)
    shutil.copytree(ROOT / 'outputs/douyin-independent-extension', payload / 'outputs/douyin-independent-extension', dirs_exist_ok=True, ignore=ignored)
    shutil.copy2(ROOT / 'packaging/首次安装.command', output / '首次安装.command')
    (output / '首次安装.command').chmod(0o755)
    shutil.copy2(ROOT / 'packaging/安装说明.md', output / '安装说明.md')
    metadata['files'] = [{'path': str(path.relative_to(payload)), 'bytes': path.stat().st_size,
                          'sha256': digest(path), 'mode': stat.S_IMODE(path.stat().st_mode)}
                         for path in sorted(payload.rglob('*')) if path.is_file() and '__pycache__' not in path.parts and path.suffix not in ('.pyc', '.pyo')]
    (output / 'bundle.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')


def archive_bundle(output):
    archive = output.parent / (output.name + '.zip')
    print('Creating installer ZIP…', flush=True)
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=3) as package:
        for path in sorted(output.rglob('*')):
            if path.is_file() and '__pycache__' not in path.parts and path.suffix not in ('.pyc', '.pyo'):
                package.write(path, str(Path(output.name) / path.relative_to(output)))
    print(str(archive), flush=True)


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def ignored(directory, names):
    return [name for name in names if name in ('__pycache__', '.DS_Store') or name.endswith(('.pyc', '.pyo'))]


def is_macho(path):
    if not path.is_file():
        return False
    with path.open('rb') as source:
        return source.read(4) in (b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca')


class PortableBinaries:
    def __init__(self, payload):
        self.payload = payload
        self.copies = {}
        self.processed = set()

    def track_tree(self, source, destination):
        shutil.copytree(source, destination, dirs_exist_ok=True, symlinks=False, ignore=ignored)
        for path in source.rglob('*'):
            if path.is_file() and is_macho(path):
                target = destination / path.relative_to(source)
                if target.is_file():
                    self.copies[path.resolve()] = target

    def add(self, source, destination=None):
        source = source.resolve()
        if source in self.copies:
            return self.copies[source]
        destination = destination or self.payload / 'lib' / source.name
        if destination.exists() and digest(source) != digest(destination):
            raise RuntimeError('Portable library name collision: ' + source.name)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        destination.chmod(destination.stat().st_mode | stat.S_IWUSR)
        self.copies[source] = destination
        return destination

    def dependency(self, source, value):
        if value.startswith(('/usr/lib/', '/System/Library/')):
            return None
        if value.startswith('@loader_path/'):
            candidate = source.parent / value.removeprefix('@loader_path/')
            if candidate.exists():
                return candidate.resolve()
        if value.startswith('@executable_path/'):
            candidate = source.parent / value.removeprefix('@executable_path/')
            if candidate.exists():
                return candidate.resolve()
        if value.startswith('@rpath/'):
            details = subprocess.check_output(['otool', '-l', str(source)], text=True)
            paths = re.findall(r'cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset', details)
            for directory in paths + [str(source.parent), str(ROOT / 'work/independent-asr/build/bin')]:
                directory = directory.replace('@loader_path', str(source.parent)).replace('@executable_path', str(source.parent))
                candidate = Path(directory) / value.removeprefix('@rpath/')
                if candidate.exists():
                    return candidate.resolve()
        elif not value.startswith('@') and Path(value).is_file():
            return Path(value).resolve()
        raise RuntimeError('Cannot resolve dependency ' + value + ' for ' + str(source))

    def relocate(self):
        while self.processed != set(self.copies):
            for source, destination in list(self.copies.items()):
                if source in self.processed:
                    continue
                lines = subprocess.check_output(['otool', '-L', str(source)], text=True).splitlines()[1:]
                original_details = subprocess.check_output(['otool', '-l', str(source)], text=True)
                identities = re.findall(r'cmd LC_ID_DYLIB\s+cmdsize \d+\s+name (.+?) \(offset', original_details)
                changes = []
                for line in lines:
                    if not line.startswith('\t'):
                        continue
                    value = line.strip().split(' (compatibility version')[0]
                    if value in identities:
                        continue
                    dependency = self.dependency(source, value)
                    if dependency is not None:
                        target = self.add(dependency)
                        changes += ['-change', value, '@loader_path/' + os.path.relpath(target, destination.parent)]
                if identities:
                    changes += ['-id', '@loader_path/' + destination.name]
                if changes:
                    subprocess.run(['install_name_tool', *changes, str(destination)], check=True, capture_output=True)
                # Remove references to the build machine in LC_RPATH. All
                # non-system load commands now point to bundled relative paths.
                details = subprocess.check_output(['otool', '-l', str(destination)], text=True)
                for directory in re.findall(r'cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset', details):
                    if directory.startswith('/') and not directory.startswith(('/usr/lib', '/System/Library')):
                        subprocess.run(['install_name_tool', '-delete_rpath', directory, str(destination)], check=True, capture_output=True)
                subprocess.run(['codesign', '--force', '--sign', '-', str(destination)], check=True, capture_output=True)
                self.processed.add(source)
        # Verify there is no remaining dependency on this checkout or Homebrew.
        for destination in self.copies.values():
            text = subprocess.check_output(['otool', '-L', str(destination)], text=True)
            if any(value in text for value in ('/opt/homebrew/', '/Users/')):
                # otool's heading contains the artifact path; inspect load lines.
                if any(('/opt/homebrew/' in line or '/Users/' in line) for line in text.splitlines()[1:] if line.startswith('\t')):
                    raise RuntimeError('External library reference remains: ' + str(destination))


def build(output, make_zip=True):
    if output.exists():
        raise RuntimeError('输出目录已经存在；请为本次构建选择新目录。')
    payload = output / 'payload'
    payload.mkdir(parents=True)
    portable = PortableBinaries(payload)
    python = (ROOT / 'work/asr-venv/bin/python').resolve()
    base = python.parents[1]
    print('Bundling portable Python and installed ASR dependencies…', flush=True)
    portable.track_tree(base, payload / 'runtime')
    portable.track_tree(ROOT / 'work/asr-venv/lib/python3.12/site-packages', payload / 'runtime/lib/python3.12/site-packages')
    print('Bundling and relocating audio executables…', flush=True)
    for name in ('ffmpeg', 'ffprobe'):
        portable.add(Path(shutil.which(name)), payload / 'bin' / name)
    portable.add(ROOT / 'work/independent-asr/build/bin/whisper-cli', payload / 'work/independent-asr/build/bin/whisper-cli')
    portable.relocate()
    print('Copying helper, extension and licence records…', flush=True)
    (payload / 'scripts').mkdir()
    for name in ('native_host.py', 'transcription_bridge.py', 'transcribe_accurate.py', 'transcript_alignment.py', 'install_helper.py', 'asr-requirements.lock.txt'):
        shutil.copy2(ROOT / 'scripts' / name, payload / 'scripts' / name)
    shutil.copytree(ROOT / 'outputs/douyin-independent-extension', payload / 'outputs/douyin-independent-extension', ignore=ignored)
    shutil.copy2(ROOT / 'packaging/首次安装.command', output / '首次安装.command')
    (output / '首次安装.command').chmod(0o755)
    shutil.copy2(ROOT / 'packaging/安装说明.md', output / '安装说明.md')
    licenses = payload / 'licenses'
    licenses.mkdir()
    shutil.copy2(ROOT / 'work/independent-asr/whisper.cpp/LICENSE', licenses / 'whisper.cpp-LICENSE')
    for source in base.rglob('LICENSE*'):
        if source.is_file() and source.stat().st_size < 1024 ** 2:
            shutil.copy2(source, licenses / ('Python-' + source.name))
    notices = {
        'Python': {'version': subprocess.check_output([str(python), '--version'], text=True).strip(), 'source': 'https://github.com/astral-sh/python-build-standalone'},
        'PythonPackages': {'lock': 'scripts/asr-requirements.lock.txt', 'licences': 'runtime/lib/python3.12/site-packages/*.dist-info/licenses'},
        'FFmpeg': {'version': subprocess.check_output([shutil.which('ffmpeg'), '-version'], text=True).splitlines()[0], 'source': 'https://ffmpeg.org', 'license': subprocess.check_output([shutil.which('ffmpeg'), '-L'], text=True, stderr=subprocess.DEVNULL)},
        'Whisper.cpp': {'source': 'https://github.com/ggml-org/whisper.cpp', 'license': 'licenses/whisper.cpp-LICENSE'},
        'NativeLibraries': []
    }
    # Retain Homebrew receipt source URLs and formula build metadata for every
    # copied native component. Model URLs and SHA-256 are recorded separately.
    formulae = {}
    for source in portable.copies:
        parts = source.parts
        if 'Cellar' in parts:
            position = parts.index('Cellar')
            formula = Path(*parts[:position + 3])
            receipt = formula / 'INSTALL_RECEIPT.json'
            if receipt.is_file():
                formulae[str(formula)] = json.loads(receipt.read_text())
                for name in ('LICENSE', 'COPYING', 'COPYING.LIB', 'COPYING.GPLv2', 'COPYING.GPLv3', 'COPYING.LGPLv2.1', 'COPYING.LGPLv3'):
                    if (formula / name).is_file():
                        shutil.copy2(formula / name, licenses / (formula.parent.name + '-' + name))
    notices['NativeLibraries'] = list(formulae.values())
    (licenses / 'sources.json').write_text(json.dumps(notices, ensure_ascii=False, indent=2) + '\n')
    models = json.loads((ROOT / 'packaging/models.lock.json').read_text())
    files = [{'path': str(path.relative_to(payload)), 'bytes': path.stat().st_size,
              'sha256': digest(path), 'mode': stat.S_IMODE(path.stat().st_mode)}
             for path in sorted(payload.rglob('*')) if path.is_file()]
    (output / 'bundle.json').write_text(json.dumps({'app': 'ClipQuill', 'version': VERSION,
        'protocol': 1, 'minimum_macos': '26.0', 'architecture': 'arm64', 'files': files, 'models': models}, ensure_ascii=False, indent=2) + '\n')
    # The installed bundle must import and run with no external PATH entries.
    verify_bundle(output)
    if make_zip:
        archive_bundle(output)
    print('Installer ready: ' + str(output), flush=True)
    return output


def main():
    parser = argparse.ArgumentParser(description='构建无需用户配置环境的 Mac 安装包')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--no-zip', action='store_true')
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--refresh-sources', action='store_true')
    parser.add_argument('--archive-only', action='store_true')
    args = parser.parse_args()
    output = args.output.absolute()
    if args.archive_only:
        archive_bundle(output)
    elif args.verify_only:
        verify_bundle(output)
    elif args.refresh_sources:
        refresh_sources(output)
        verify_bundle(output)
        if not args.no_zip:
            archive_bundle(output)
    else:
        build(output, not args.no_zip)


if __name__ == '__main__':
    main()
