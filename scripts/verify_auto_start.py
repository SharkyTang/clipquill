#!/usr/bin/env python3
"""Real local helper/ASR verification; explicitly not a Chrome UI test."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import signal
import socket
import struct
import subprocess
import time
import urllib.error
import urllib.request

from install_helper import extension_id, atomic_json

ROOT = Path(__file__).resolve().parents[1]


def call_host(target, origin):
    body = json.dumps({'action': 'ensureService', 'protocol': 1}).encode()
    completed = subprocess.run([str(target / 'scripts/native-host.command'), origin + '/'],
        input=struct.pack('=I', len(body)) + body, capture_output=True, timeout=40)
    if len(completed.stdout) < 4:
        raise RuntimeError('Native protocol failed: ' + completed.stderr.decode(errors='replace')[:400])
    length = struct.unpack('=I', completed.stdout[:4])[0]
    assert length == len(completed.stdout) - 4
    return json.loads(completed.stdout[4:])


def request(origin, path, payload=None):
    value = urllib.request.Request('http://127.0.0.1:8766' + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Origin': origin, **({'Content-Type': 'application/json'} if payload is not None else {})})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(value, timeout=20) as response:
        body = response.read()
        return body if path.endswith('/audio') else json.loads(body)


def stop_owned_service(target, origin):
    pid_path = target / 'work/native-service.pid'
    if not pid_path.is_file():
        return
    try:
        if request(origin, '/health').get('busy'):
            raise RuntimeError('A transcription is still running; verification will not stop it.')
        os.kill(int(pid_path.read_text()), signal.SIGTERM)
    except (urllib.error.URLError, ProcessLookupError):
        return
    for _ in range(50):
        try:
            with socket.create_connection(('127.0.0.1', 8766), timeout=0.2):
                pass
        except OSError:
            return
        time.sleep(0.1)
    raise RuntimeError('Owned service did not stop')


def verify(package, target):
    try:
        with socket.create_connection(('127.0.0.1', 8766), timeout=0.2):
            raise RuntimeError('8766 is already in use; do not stop another service for this test.')
    except ConnectionRefusedError:
        pass
    print('Installing into a fresh validation directory…', flush=True)
    subprocess.run([str(package / 'payload/runtime/bin/python3.12'), '-B', str(package / 'payload/scripts/install_helper.py'),
        '--package', str(package), '--target', str(target), '--host-directory', str(target / 'test-chrome-registration'),
        '--seed-models', str(ROOT), '--existing-extension', str(ROOT / 'outputs/douyin-independent-extension'), '--no-open'], check=True)
    origin = 'chrome-extension://' + extension_id(ROOT / 'outputs/douyin-independent-extension')
    evidence = {'chromeUiVerified': False, 'newComputerVerified': False, 'firstInstallUsedLocalModelSeed': True}
    try:
        print('Starting through real native stdin/stdout framing…', flush=True)
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: call_host(target, origin), range(2)))
        assert all(result['ok'] for result in responses), responses
        assert sum(result['reused'] is False for result in responses) == 1, responses
        evidence['concurrentColdStart'] = responses
        first_pid = (target / 'work/native-service.pid').read_text().strip()
        assert call_host(target, origin)['reused'] is True
        assert (target / 'work/native-service.pid').read_text().strip() == first_pid
        evidence['hostExitKeepsServiceRunning'] = request(origin, '/health')['ready'] is True
        denied = call_host(target, 'chrome-extension://' + 'a' * 32)
        assert denied['code'] == 'UNPAIRED_EXTENSION'
        try:
            request('https://example.com', '/health')
            raise AssertionError('untrusted origin accepted')
        except urllib.error.HTTPError as exc:
            assert exc.code == 403
        evidence['unauthorizedOriginsRejected'] = True
        print('Running a real historical downloaded video through bundled tools and models…', flush=True)
        work_id = '7691611431967718755'
        download_root = Path.home() / 'Downloads/抖音独立导出'
        source = next(path for path in download_root.glob(work_id + '_*p_*.mp4') if path.is_file() and not path.is_symlink())
        height = int(re.match(work_id + r'_(\d+)p_', source.name)[1])
        info = json.loads(subprocess.check_output([str(target / 'bin/ffprobe'), '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(source)]))
        duration = float(info['format']['duration'])
        payload = {'workId':work_id, 'durationMs':round(duration * 1000), 'variants':[{'height':height,'expectedBytes':source.stat().st_size}]}
        found = request(origin, '/videos/find', payload)['file']
        source = Path(found['path'])
        assert source.is_file() and source.stat().st_size == found['expectedBytes']
        job = request(origin, '/jobs', {**found,'title':'v0.1.5 local helper verification','terms':''})
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            job = request(origin, '/jobs/' + job['id'])
            if job['status'] != 'running':
                break
            time.sleep(2)
        assert job['status'] == 'complete', {key:job.get(key) for key in ('status','error','stage')}
        assert job['text'] and job['srt'] and job['hasAudio']
        assert request(origin, '/jobs/' + job['id'] + '/audio')
        evidence['transcription'] = {key:job[key] for key in ('id','workId','status','characters','segments','elapsedSeconds','inputSha256')}
        print('Testing a real startup failure followed by a retry…', flush=True)
        stop_owned_service(target, origin)
        python = target / 'work/asr-venv/bin/python'
        backup = python.with_name('python.validation-backup')
        python.rename(backup)
        try:
            failed = call_host(target, origin)
            assert failed['ok'] is False and failed['code'] == 'INSTALLATION_INCOMPLETE'
            evidence['failedStartup'] = failed['code']
        finally:
            backup.rename(python)
        retried = call_host(target, origin)
        assert retried['ok'] and retried['reused'] is False
        evidence['startupRetrySucceeded'] = True
        # Prove the saved job and audio survive service restart.
        assert request(origin, '/jobs/' + job['id'])['status'] == 'complete'
        assert request(origin, '/jobs/' + job['id'] + '/audio')
        evidence['resultsSurviveRestart'] = True
        evidence['verifiedAtUnix'] = time.time()
        atomic_json(ROOT / 'work/auto-start-validation.json', evidence)
        print(json.dumps(evidence, ensure_ascii=False, indent=2), flush=True)
        return evidence
    finally:
        stop_owned_service(target, origin)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--package', type=Path, default=ROOT / 'outputs/ClipQuill-v0.1.5-mac-arm64')
    parser.add_argument('--target', type=Path, default=ROOT / 'work/auto-start-validation-helper')
    args = parser.parse_args()
    verify(args.package.resolve(), args.target.resolve())


if __name__ == '__main__':
    main()
