import test from 'node:test';
import assert from 'node:assert/strict';
import {completedFile, checkJob, checkService, localRequest} from '../../outputs/douyin-independent-extension/transcription.mjs';
const id='7689864994510343451';
test('transcription waits for a complete download and rejects partial or interrupted media',()=>{
  assert.equal(completedFile({state:'in_progress'},12),null);
  assert.equal(completedFile({state:'complete',fileSize:12,filename:'/downloads/a.mp4'},12),'/downloads/a.mp4');
  assert.throws(()=>completedFile({state:'complete',fileSize:11,filename:'/downloads/a.mp4'},12));
  assert.throws(()=>completedFile({state:'interrupted',error:'NETWORK_FAILED'},12));
});
test('validates service identity and rejects results belonging to another work',()=>{
  checkService({service:'douyin-local-transcription',protocol:1,ready:true});
  assert.throws(()=>checkService({service:'other',ready:true}));
  assert.throws(()=>checkService({service:'douyin-local-transcription',protocol:1,ready:false}));
  assert.throws(()=>checkService({service:'douyin-local-transcription',protocol:1,ready:true},true),/关闭原服务窗口/);
  checkService({service:'douyin-local-transcription',protocol:1,ready:true,videoReuse:true},true);
  const job={id:'a'.repeat(32),workId:id,status:'complete',text:'文案',srt:'字幕',elapsedSeconds:1};
  assert.equal(checkJob(job,id),job);
  assert.throws(()=>checkJob(job,'1111111111111111111'));
  assert.throws(()=>checkJob({...job,text:''},id));
});
test('local requests never send credentials and surface service and connection failures',async()=>{
  const payload={path:'/downloads/a.mp4'};
  await localRequest('/jobs',payload,async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:8766/jobs');
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    assert.deepEqual(JSON.parse(options.body),payload);
    return {ok:true,json:async()=>({})};
  });
  await assert.rejects(localRequest('/health',undefined,async()=>{throw new TypeError('Failed to fetch');}),error=>error.code === 'SERVICE_UNAVAILABLE');
  await assert.rejects(localRequest('/jobs',payload,async()=>({ok:false,json:async()=>({error:'已有任务'})})),/已有任务/);
  await assert.rejects(localRequest('/jobs',payload,async()=>({ok:false,json:async()=>({error:'文件丢失',code:'SOURCE_MISSING'})})),error=>error.code === 'SOURCE_MISSING');
});
