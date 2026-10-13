#!/usr/bin/env python3
"""Bounded acceptance probe: interrupt only a newly created, named test job.

This is a test helper, not part of the extension or transcription runtime.
It never changes models, job JSON, source media, or browser state.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def process_args(pid):
    return subprocess.check_output(['ps', '-p', str(pid), '-o', 'args='], text=True).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--service-pid', type=int, required=True)
    parser.add_argument('--work-id', required=True)
    parser.add_argument('--timeout', type=int, default=180)
    args = parser.parse_args()
    if not args.work_id.isdigit() or not 10 <= len(args.work_id) <= 30:
        parser.error('Invalid work identity')
    if not 1 <= args.timeout <= 300:
        parser.error('Probe timeout must be bounded')
    service_args = process_args(args.service_pid)
    if 'scripts/transcription_bridge.py' not in service_args:
        raise RuntimeError('Selected process is not the existing project service')
    started = time.time()
    result = {'scope':'real service process interruption; human Chrome starts the task',
              'workId':args.work_id,'faultInjected':False,'startedAt':started}
    evidence = ROOT / 'outputs/phase-01/round2/evidence/task-failure-probe.json'
    print('Probe ready for one new test extraction. Existing jobs are excluded.', flush=True)
    while time.time() - started < args.timeout:
        for path in (ROOT / 'work/transcription-jobs').glob('*.json'):
            try:
                job = json.loads(path.read_text())
            except (OSError, ValueError):
                continue
            if job.get('workId') != args.work_id or job.get('status') != 'running' or job.get('startedAt',0) <= started:
                continue
            children = subprocess.run(['pgrep','-P',str(args.service_pid)], capture_output=True, text=True).stdout.split()
            for value in children:
                pid = int(value)
                try:
                    command = process_args(pid)
                except subprocess.CalledProcessError:
                    continue
                if 'scripts/transcribe_accurate.py' not in command or (job['id'] + '.mp4') not in command:
                    continue
                if os.getpgid(pid) != pid:
                    raise RuntimeError('The test child is not in its own process group')
                # The service itself creates this isolated group for inference.
                os.killpg(pid,signal.SIGTERM)
                result.update(jobId=job['id'],faultInjected=True,interruptedAt=time.time(),
                              originalModelConfigurationChanged=False,serviceStopped=False)
                print('Interrupted this new test inference only:',job['id'],flush=True)
                for _ in range(50):
                    current = json.loads(path.read_text())
                    if current.get('status') != 'running':
                        result.update(status=current['status'],error=current.get('error'),stage=current.get('stage'))
                        break
                    time.sleep(.2)
                evidence.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
                print('Observed service status:',result.get('status'),flush=True)
                return
        time.sleep(.2)
    result['result'] = 'No matching new task appeared before timeout; no process interrupted'
    evidence.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(result['result'],flush=True)


if __name__ == '__main__':
    main()
