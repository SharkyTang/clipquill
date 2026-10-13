import test from 'node:test';
import assert from 'node:assert/strict';
import {startVideoTranscription} from '../../outputs/douyin-independent-extension/video.mjs';

const id = '7689864994510343451';
const work = {
  id, title: '视频复用测试', durationMs: 300000,
  variants: [720,1080].map(height => ({height,width:height === 720 ? 1280 : 1920,
    size:height,format:'mp4',isH265:0,urls:['https://v3-dy-o.zjcdn.com/test.mp4']}))
};
const file = (height = 720) => ({workId:id,durationMs:work.durationMs,expectedBytes:height,height,
  path:`/downloads/抖音独立导出/${id}_${height}p_视频复用测试 (1).mp4`});
const job = {id:'a'.repeat(32),workId:id,status:'running'};

test('an existing video is reused on every extraction, including reopening the page',async()=>{
  let lookups=0, submissions=0;
  const request=async(path,payload)=>{
    if(path === '/videos/find') {
      lookups++;
      assert.equal(payload.workId,id);
      assert.deepEqual(payload.variants,[{height:720,expectedBytes:720},{height:1080,expectedBytes:1080}]);
      assert.ok(!JSON.stringify(payload).includes('https://'));
      return {file:file()};
    }
    assert.equal(path,'/jobs'); submissions++;
    assert.equal(payload.path,file().path); assert.equal(payload.terms,'测试术语');
    assert.equal(payload.title,work.title); return job;
  };
  for(let attempt=0;attempt<3;attempt++) {
    assert.equal(await startVideoTranscription(work,720,'测试术语',{
      request,download:async()=>assert.fail('must reuse the existing video'),
      onSource:({reused,candidate})=>{assert.equal(reused,true);assert.equal(candidate.height,720);}
    }),job);
  }
  assert.equal(lookups,3); assert.equal(submissions,3);
});

test('changing preferred download quality still reuses a complete compatible local video',async()=>{
  let actualHeight;
  await startVideoTranscription(work,720,'',{
    request:async(path,payload)=>path === '/videos/find' ? {file:file(1080)} : (assert.equal(payload.expectedBytes,1080),job),
    download:async()=>assert.fail('quality preference must not duplicate a complete video'),
    onSource:({candidate})=>{actualHeight=candidate.height;}
  });
  assert.equal(actualHeight,1080);
});

test('a missing or incomplete local file causes one download before transcription',async()=>{
  let downloads=0;
  await startVideoTranscription(work,720,'',{
    request:async(path,payload)=>{
      if(path === '/videos/find') return {file:null};
      assert.equal(payload.path,'/downloads/new.mp4'); assert.equal(downloads,1); return job;
    },
    download:async()=>{downloads++;return {...file(),path:'/downloads/new.mp4'};},
    onSource:({reused})=>assert.equal(reused,false)
  });
  assert.equal(downloads,1);
});

test('failed recognition and busy-service retries keep the existing input without redownloading',async()=>{
  for(const code of [undefined,'MODEL_UNAVAILABLE','SERVICE_BUSY']) {
    const failure=Object.assign(new Error('识别或服务失败'),{code});
    for(let attempt=0;attempt<2;attempt++) {
      await assert.rejects(startVideoTranscription(work,720,'',{
        request:async(path)=>{if(path === '/videos/find') return {file:file()};throw failure;},
        download:async()=>assert.fail('recognition errors must not trigger downloads')
      }),error=>error === failure);
    }
  }
});

test('a file lost or truncated after lookup is checked again and replaced once',async()=>{
  for(const code of ['SOURCE_MISSING','SOURCE_INCOMPLETE']) {
    let lookups=0, submissions=0, downloads=0;
    await startVideoTranscription(work,720,'术语',{
      request:async(path,payload)=>{
        if(path === '/videos/find') return {file:++lookups === 1 ? file() : null};
        if(++submissions === 1) throw Object.assign(new Error('文件已变化'),{code});
        assert.equal(payload.path,'/downloads/replacement.mp4'); assert.equal(payload.terms,'术语'); return job;
      },
      download:async()=>{downloads++;return {...file(),path:'/downloads/replacement.mp4'};}
    });
    assert.equal(lookups,2);assert.equal(submissions,2);assert.equal(downloads,1);
  }
});

test('unavailable service and invalid or mismatched lookup results stop without downloading',async()=>{
  const invalid=[{},null,{file:{...file(),workId:'1111111111111111111'}},
    {file:{...file(),expectedBytes:1}},{file:{...file(),durationMs:1}},{file:{...file(),path:null}}];
  for(const result of invalid) {
    await assert.rejects(startVideoTranscription(work,720,'',{
      request:async(path)=>{assert.equal(path,'/videos/find');return result;},
      download:async()=>assert.fail('invalid service data must not trigger downloads')
    }));
  }
  await assert.rejects(startVideoTranscription(work,720,'',{
    request:async()=>{throw new Error('无法连接本地服务');},
    download:async()=>assert.fail('connection errors must not trigger downloads')
  }),/无法连接/);
});

test('incomplete new downloads stop processing and source replacement cannot loop forever',async()=>{
  let submissions=0;
  await assert.rejects(startVideoTranscription(work,720,'',{
    request:async()=>({file:null}), download:async()=>{throw new Error('下载文件大小不一致');}
  }),/大小不一致/);
  await assert.rejects(startVideoTranscription(work,720,'',{
    request:async(path)=>{
      if(path === '/videos/find') return {file:file()};
      submissions++;throw Object.assign(new Error('文件再次丢失'),{code:'SOURCE_MISSING'});
    }, download:async()=>assert.fail('the second lookup still found a complete video')
  }),/再次丢失/);
  assert.equal(submissions,2);
});
