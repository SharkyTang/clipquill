import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskProgress} from '../../outputs/douyin-independent-extension/progress.mjs';

const workId = '7689864994510343451', jobId = 'a'.repeat(32);
const base = {id:jobId,workId,status:'running',stage:'准备音频'};
function fixture() {
  let ms = 0;
  const wall = 1800000000000;
  return {progress:createTaskProgress({now:()=>ms,wallNow:()=>wall}),advance:value=>{ms+=value;},wall};
}

test('a download reports only real browser-observed steps, never fabricated later stages', () => {
  const {progress:p,advance} = fixture();
  p.begin('download',{sourceVideoId:workId}); p.enter('metadata','读取作品信息');
  advance(250); p.complete('metadata'); p.enter('download','下载视频');
  advance(750); p.complete('download'); const view = p.finish();
  assert.equal(view.state,'succeeded'); assert.equal(view.totalElapsedMs,1000);
  assert.equal(view.totalTimingLabel,'本页观测用时');
  assert.deepEqual(view.phases.map(item=>[item.key,item.state,item.elapsedMs]),[
    ['metadata','completed',250],['download','completed',750]
  ]);
  assert.equal(view.phases.some(item=>/音频|对齐|校对/.test(item.label)),false);
});

test('reusing a confirmed local source displays reused with no download duration', () => {
  const {progress:p,advance} = fixture();
  p.begin('transcript'); p.enter('video','检查本地视频'); advance(1200);
  const phase = p.reuse('video','本地视频').phases[0];
  assert.equal(phase.state,'skipped'); assert.equal(phase.reused,true); assert.equal(phase.detail,'已复用');
  assert.equal(phase.elapsedMs,undefined); assert.equal(phase.timingSource,undefined);
});

test('reported backend transitions use partial page observations and real server task total', () => {
  const {progress:p,advance,wall} = fixture();
  p.begin('transcript',{sourceVideoId:workId}); p.observeJob({...base,startedAt:(wall-10000)/1000});
  advance(2000); p.observeJob({...base,stage:'中文模型识别与逐句时间对齐'});
  advance(3000); const view = p.observeJob({...base,status:'complete',stage:'完成',startedAt:(wall-10000)/1000,finishedAt:wall/1000,elapsedSeconds:3});
  assert.equal(view.totalElapsedMs,10000); assert.equal(view.totalTimingSource,'server');
  assert.equal(view.totalTimingLabel,'本地服务任务用时');
  assert.equal(view.phases[0].elapsedMs,2000); assert.equal(view.phases[0].timingLabel,'本页观测');
  assert.equal(view.phases[1].elapsedMs,3000);
  assert.equal(view.phases.at(-1).label,'文案结果已返回');
  assert.equal(view.phases.some(item=>item.label==='生成字幕'),false);
});

test('a resumed completed result cannot invent unobserved stage durations from ASR elapsedSeconds', () => {
  const {progress:p} = fixture();
  p.begin('transcript',{sourceVideoId:workId,taskId:jobId,restored:true});
  const view = p.observeJob({...base,status:'complete',stage:'完成',elapsedSeconds:47.8});
  assert.equal(view.state,'succeeded'); assert.equal(view.totalElapsedMs,undefined);
  assert.deepEqual(view.phases.map(item=>item.label),['文案结果已返回']);
  assert.equal(view.phases[0].elapsedMs,undefined); assert.match(view.timingNote,/耗时未知/);
});

test('a disconnect leaves the active phase unknown; reconnection does not count the gap', () => {
  const {progress:p,advance} = fixture();
  p.begin('transcript',{sourceVideoId:workId}); p.observeJob(base); advance(2000);
  const disconnected = p.fail({code:'SERVICE_UNAVAILABLE',jobUncertain:true,message:'连接中断'});
  assert.equal(disconnected.state,'disconnected'); assert.equal(disconnected.phases[0].state,'unknown');
  assert.equal(disconnected.totalElapsedMs,undefined); assert.equal(disconnected.phases[0].elapsedMs,undefined);
  advance(10000); p.observeJob(base); advance(2000);
  const view = p.observeJob({...base,status:'complete',stage:'完成'});
  assert.equal(view.state,'succeeded'); assert.equal(view.totalElapsedMs,undefined);
  assert.equal(view.phases[0].elapsedMs,undefined); assert.match(view.phases[0].timingNote,/未记录/);
});

test('a coarse backend failure reports uncertainty about the exact failing step', () => {
  const {progress:p,advance} = fixture();
  p.begin('transcript',{sourceVideoId:workId}); p.enter('metadata','读取作品信息'); advance(100);p.complete('metadata');p.observeJob(base);
  advance(2000); const view = p.observeJob({...base,status:'failed',stage:'失败',error:'实际视频时长与作品数据不一致。'});
  assert.equal(view.state,'failed'); assert.equal(view.phases[0].state,'completed');
  assert.equal(view.phases[1].state,'unknown'); assert.equal(view.phases.at(-1).state,'failed');
  assert.match(view.phases.at(-1).detail,/未报告具体失败步骤/);
  assert.match(view.error,/实际视频时长/);
});

test('a known frontend failure marks its observed active step failed and preserves completed steps', () => {
  const {progress:p,advance} = fixture();
  p.begin('download');p.enter('metadata','读取作品信息');advance(10);p.complete('metadata');p.enter('download','下载视频');
  advance(200);const view=p.fail(new Error('下载中断（NETWORK_FAILED）'));
  assert.equal(view.phases[0].state,'completed');assert.equal(view.phases[1].state,'failed');
  assert.equal(view.phases[1].elapsedMs,200);assert.match(view.error,/NETWORK_FAILED/);
});

test('late responses from another video or job cannot alter phases, identity or result state', () => {
  const {progress:p} = fixture();
  p.begin('transcript',{sourceVideoId:workId,taskId:jobId});p.observeJob(base);
  const before=p.view();
  assert.deepEqual(p.observeJob({...base,id:'b'.repeat(32),status:'complete'}),before);
  assert.deepEqual(p.observeJob({...base,workId:'1111111111111111111',status:'failed'}),before);
});

test('unknown states and invalid server times never become completion or NaN durations', () => {
  const {progress:p,wall} = fixture();
  p.begin('transcript',{restored:true});
  const unknown=p.observeJob({...base,status:'queued',startedAt:NaN,finishedAt:Infinity});
  assert.equal(unknown.state,'unknown'); assert.equal(unknown.totalElapsedMs,undefined);
  const view=p.observeJob({...base,status:'complete',startedAt:(wall+120000)/1000,finishedAt:wall/1000});
  assert.equal(view.totalElapsedMs,undefined);assert.equal(JSON.stringify(view).includes('NaN'),false);
});

test('view snapshots are detached, pending is explicit, and reset hides the previous task', () => {
  const {progress:p} = fixture();
  p.begin('transcript');p.pending('video','视频来源');
  const snapshot=p.view();snapshot.phases[0].label='changed';snapshot.phases.push({key:'fake'});
  assert.equal(p.view().phases[0].label,'视频来源');assert.equal(p.view().phases.length,1);
  assert.equal(p.view().phases[0].state,'pending');
  const idle=p.reset();assert.equal(idle.state,'idle');assert.deepEqual(idle.phases,[]);
});

test('a disappeared reused file that is really downloaded no longer claims reuse', () => {
  const {progress:p,advance} = fixture();
  p.begin('transcript');p.reuse('download','本地视频');
  p.enter('download','下载视频','原文件缺失，正在下载');advance(300);p.complete('download');
  const phase=p.view().phases[0];
  assert.equal(phase.reused,undefined);assert.equal(phase.elapsedMs,300);
  assert.equal(phase.state,'completed');assert.match(phase.detail,/正在下载/);
});
