#!/usr/bin/env python3
"""Inspect actual local Chrome artifacts, without controlling the browser.

Records facts only. Human UI checks remain separate acceptance evidence.
"""
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'outputs/phase-01/round2/evidence'
DOWNLOADS = Path.home() / 'Downloads'


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def timestamp_ms(text):
    match = re.fullmatch(r'(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})',text)
    if not match:
        raise ValueError('Invalid SRT timestamp')
    h,m,s,ms = map(int,match.groups())
    return h*3600000 + m*60000 + s*1000 + ms


def inspect_srt(text, duration_ms):
    # Compare the media bound at the timestamp format's one-millisecond precision.
    media_end_ms = math.floor(duration_ms + .5)
    chunks = text.rstrip('\n').split('\n\n')
    body, intervals, previous_end = [], [], 0
    for index,chunk in enumerate(chunks,1):
        lines = chunk.split('\n')
        if len(lines)<3 or lines[0] != str(index):
            raise ValueError('Invalid SRT order or empty cue')
        pair = lines[1].split(' --> ')
        if len(pair)!=2:
            raise ValueError('Invalid SRT interval')
        begin,end = map(timestamp_ms,pair)
        if not previous_end <= begin < end <= media_end_ms:
            raise ValueError('SRT interval overlaps or is out of media bounds')
        if not all(line.strip() for line in lines[2:]):
            raise ValueError('Blank line within an SRT cue')
        previous_end=end
        intervals.append((begin,end))
        body.extend(lines[2:])
    return '\n'.join(body), intervals


def main():
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    registry = json.loads((ROOT/'outputs/phase-01/样本登记.json').read_text())
    start = (EVIDENCE/'media-before.json').stat().st_mtime
    jobs=[]
    for path in (ROOT/'work/transcription-jobs').glob('*.json'):
        try:
            job=json.loads(path.read_text())
            jobs.append(job)
        except (OSError,ValueError):
            continue
    result={'checkedAt':time.time(),'scope':'actual files and service states; does not assert human UI acceptance',
            'roundStartedAt':start,'samples':[]}
    for sample in registry['samples']:
        identity=sample['workId']
        row={'sampleId':sample['sampleId'],'workId':identity,'media':None,'exports':{},'serviceTasks':[]}
        media=sorted((DOWNLOADS/'抖音独立导出').glob(identity+'_*.mp4'),key=lambda p:p.stat().st_mtime)
        if media:
            path=media[-1]
            metadata=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries',
                'format=duration,size:stream=codec_name,codec_type,width,height','-of','json',str(path)]))
            decode=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-f','null','-'],capture_output=True,text=True)
            duration=float(metadata['format']['duration'])*1000
            expected=sample.get('durationMs')
            row['media']={'name':path.name,'bytes':path.stat().st_size,'modifiedAt':path.stat().st_mtime,
                'createdThisRound':path.stat().st_mtime>start,'sha256':sha256(path),'metadata':metadata,
                'fullDecode':decode.returncode==0 and not decode.stderr.strip(),'decodeError':decode.stderr[:500],
                'durationMatchesRegisteredWork':expected is None or abs(duration-expected)<2000}
        matching=sorted((j for j in jobs if j.get('workId')==identity),key=lambda j:j['startedAt'])
        row['serviceTasks']=[{k:j.get(k) for k in ('id','status','startedAt','finishedAt','terms',
            'inputSha256','characters','segments','elapsedSeconds','error')} for j in matching if j['startedAt']>start]
        completed = [j for j in matching if j.get('status') == 'complete']
        row['latestCompletedTaskInputMatchesActualMedia'] = bool(row['media'] and completed and
            completed[-1].get('inputSha256') == row['media']['sha256'])
        txt=sorted(DOWNLOADS.glob(identity+'_文案_当前稿*.txt'),key=lambda p:p.stat().st_mtime)
        srt=sorted(DOWNLOADS.glob(identity+'_文案_当前稿*.srt'),key=lambda p:p.stat().st_mtime)
        for kind,files in [('txt',txt),('srt',srt)]:
            if files:
                path=files[-1]
                row['exports'][kind]={'name':path.name,'bytes':path.stat().st_size,'sha256':sha256(path),
                    'modifiedAt':path.stat().st_mtime,'createdThisRound':path.stat().st_mtime>start}
        if txt and srt and row['media']:
            try:
                content,intervals=inspect_srt(srt[-1].read_text(),duration)
                row['exports'].update(txtSrtTextExactMatch=txt[-1].read_text()==content,
                    srtIntervalsValid=True,cues=len(intervals))
                eligible=[j for j in matching if j.get('status')=='complete' and j.get('finishedAt',0)<=srt[-1].stat().st_mtime+1]
                compatible=[]
                for job in eligible:
                    sources=job.get('reviewSegments',[])
                    starts={math.floor(s['startMs']+.5) for s in sources}
                    ends={math.floor(s['endMs']+.5) for s in sources}
                    if all(begin in starts and end in ends for begin,end in intervals):compatible.append(job['id'])
                row['exports']['allTimesFromExistingJobEndpoints']=bool(compatible)
                row['exports']['compatibleSourceJobIds']=compatible
            except (ValueError,KeyError) as error:
                row['exports'].update(srtIntervalsValid=False,error=str(error))
        result['samples'].append(row)
    result['distinctMedia']=sum(bool(s['media']) for s in result['samples'])
    result['mediaWithSuccessfulService']=sum(bool(s['media']) and any(j.get('status')=='complete' for j in jobs if j.get('workId')==s['workId']) for s in result['samples'])
    path=EVIDENCE/'sample-file-verification.json'
    if path.exists():
        old=EVIDENCE/'sample-file-verification-initial.json'
        if not old.exists():old.write_bytes(path.read_bytes())
    path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print('Actual distinct media:',result['distinctMedia'])
    for sample in result['samples']:
        tasks=sample['serviceTasks']
        print(sample['sampleId'],'media',bool(sample['media']),
              'new task',tasks[-1]['status'] if tasks else 'none',
              'TXT/SRT',sample['exports'].get('txtSrtTextExactMatch','not both present'))


if __name__=='__main__':
    main()
