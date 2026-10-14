import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync, existsSync} from 'node:fs';
import * as core from '../../outputs/douyin-independent-extension/core.mjs';
import * as transcription from '../../outputs/douyin-independent-extension/transcription.mjs';
import * as video from '../../outputs/douyin-independent-extension/video.mjs';
import * as review from '../../outputs/douyin-independent-extension/review.mjs';
import * as draft from '../../outputs/douyin-independent-extension/draft.mjs';
import * as settings from '../../outputs/douyin-independent-extension/settings.mjs';
import * as service from '../../outputs/douyin-independent-extension/service.mjs';
import * as metadata from '../../outputs/douyin-independent-extension/metadata.mjs';
import * as progress from '../../outputs/douyin-independent-extension/progress.mjs';

// These tests run the production entry module with controlled Chrome and service
// boundaries. No CDN access, download, user storage or model job is started.
const directory = new URL('../../outputs/douyin-independent-extension/', import.meta.url);
const editorURL = new URL('editor.mjs', directory);
const editor = existsSync(editorURL) ? await import(editorURL.href) : {};
const html = readFileSync(new URL('tool.html', directory), 'utf8');
const source = readFileSync(new URL('tool.js', directory), 'utf8').replace(/^import .*;\n/gm, '');
const workId = '7689864994510343451';
const workURL = `https://www.douyin.com/video/${workId}`;
const work = {id:workId, title:'隔离任务契约测试', durationMs:5000,
  variants:[{width:1280,height:720,size:123,format:'mp4',isH265:0,urls:['https://v3-dy-o.zjcdn.com/task-contract.mp4']}]};
const job = {id:'a'.repeat(32),workId,status:'running',stage:'准备音频',startedAt:Date.now()/1000};
const complete = {...job,title:work.title,status:'complete',stage:'完成',text:'原始第一句。\n原始第二句。',srt:'original srt',
  durationSeconds:5,characters:12,segments:2,elapsedSeconds:1.25,hasAudio:true,
  reviewSegments:[{id:0,startMs:100,endMs:1500,text:'原始第一句。'},{id:1,startMs:2000,endMs:4000,text:'原始第二句。'}]};
const ready = {service:'douyin-local-transcription',protocol:1,ready:true,videoReuse:true};
function deferred() { let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;}); return {promise,resolve,reject}; }
async function settle() { for (let i=0;i<8;i++) await Promise.resolve(); }
async function until(predicate) { for(let i=0;i<100&&!predicate();i++)await Promise.resolve();assert.ok(predicate(),'controlled async boundary was not reached'); }
function cache(text = '人工修改仍需保留。\n原始第二句。') {
  const current = draft.editFullText(draft.createDraft(complete,review.createReview(complete)),text);
  return new Map([
    ['lastCompleted-v1',JSON.stringify({id:complete.id,workId})],
    ['lastTranscription',JSON.stringify({id:complete.id,workId})],
    ['result-v1-' + complete.id,JSON.stringify(complete)],
    ['draft-v1-' + complete.id,JSON.stringify(draft.saveableDraft(current))]
  ]);
}
function render(overrides = {}, fixture = {}) {
  const saved = fixture.saved || new Map(), elements = new Map();
  const messages = [], downloads = [], requests = [], audio = [], exports = [], copied = [];
  const objectURLs = new Map(), failWrites = new Set(fixture.failWrites || []), windowHandlers = new Map(), images = [];
  const document = {activeElement:null,getElementById:id=>elements.get(id),querySelectorAll:()=>[],
    createElement(tag) {
      if (tag==='a') return {click(){exports.push({name:this.download,blob:objectURLs.get(this.href)});}};
      const node = {dataset:{},children:[],textContent:'',append(...children){this.children.push(...children);},
        setAttribute(name,value){this[name]=value;},removeAttribute(name){delete this[name];}};
      if (tag==='img') images.push(node);
      return node;
    }};
  for (const match of html.matchAll(/\bid="([^"]+)"[^>]*>/g)) {
    const handlers = new Map();
    elements.set(match[1], {hidden:/\bhidden\b/.test(match[0]),disabled:false,checked:false,open:false,
      value:'',textContent:'',dataset:{},options:[],children:[],handlers,selectionStart:0,selectionEnd:0,
      classList:{add(){},remove(){},toggle(){}},
      addEventListener(name,listener){handlers.set(name,[...handlers.get(name)||[],listener]);},
      removeEventListener(name,listener){handlers.set(name,(handlers.get(name)||[]).filter(value=>value!==listener));},
      async emit(name,event={}){for(const listener of handlers.get(name)||[])await listener(event);},
      async click(){if(!this.disabled)return this.emit('click');},
      replaceChildren(...children){this.options=children;this.children=children;this.value=children[0]?.value||'';},
      append(...children){this.options.push(...children);this.children=this.options;if(this.options.length===1)this.value=children[0]?.value;},
      focus(){document.activeElement=this;},select(){this.selectionStart=0;this.selectionEnd=this.value.length;},
      setAttribute(name,value){this[name]=value;},removeAttribute(name){delete this[name];},
      scrollIntoView(){},pause(){},load(){},async play(){}
    });
  }
  elements.get('quality').value='720'; elements.get('existingAction').value='transcribe';
  const localStorage = {getItem:key=>saved.get(key)??null,setItem(key,value){if(failWrites.has(key))throw new Error('fixture storage full');saved.set(key,value);},removeItem:key=>saved.delete(key)};
  const chrome = {
    runtime:{getManifest:()=>({version:'0.1.5'}),async sendMessage(message){messages.push(message);return fixture.message?fixture.message(message):{ok:true,tabId:10,work};}},
    tabs:{async query(query){return fixture.query?fixture.query(query):[];},async update(){return{windowId:2};}},windows:{async update(){}},
    downloads:{onChanged:{addListener(){}},async download(value){downloads.push(value);return 1;},async search(){return[{state:'complete',fileSize:123,filename:'/isolated-test/a.mp4'}];}}
  };
  class FixtureURL extends URL {
    static createObjectURL(blob){const value='blob:task-contract-'+objectURLs.size;objectURLs.set(value,blob);return value;}
    static revokeObjectURL(value){objectURLs.delete(value);}
  }
  const timer = (callback,delay,...args) => {
    if(delay===2000){queueMicrotask(()=>callback(...args));return 0;}
    const id=setTimeout(callback,delay,...args);id.unref?.();return id;
  };
  const context = vm.createContext({...core,...transcription,...video,...review,...draft,...settings,...service,...editor,...metadata,...progress,
    ensureLocalService:async()=>ready,
    async localRequest(path,...args){requests.push(path);return overrides.localRequest?overrides.localRequest(path,...args):complete;},
    async localAudio(id){audio.push(id);return overrides.localAudio?overrides.localAudio(id):new Blob(['test audio']);},
    ...overrides,document,localStorage,chrome,Blob,URL:FixtureURL,AbortController,AbortSignal,
    navigator:{clipboard:{async writeText(text){copied.push(text);}}},
    setTimeout:timer,clearTimeout,queueMicrotask,console,
    addEventListener(name,listener){windowHandlers.set(name,listener);},removeEventListener(name){windowHandlers.delete(name);}
  });
  // Make requests observable even when the boundary has a custom implementation.
  context.localRequest=async(path,...args)=>{requests.push(path);return overrides.localRequest?overrides.localRequest(path,...args):complete;};
  context.localAudio=async(id)=>{audio.push(id);return overrides.localAudio?overrides.localAudio(id):new Blob(['test audio']);};
  context.window=context;
  vm.runInContext(source,context,{filename:'production-tool.js'});
  elements.get('link').value=workURL;
  return {elements,saved,failWrites,messages,downloads,requests,audio,exports,copied,objectURLs,context,images,
    dispatchWindow(name,event={}){return windowHandlers.get(name)?.(event);}};
}
function phases(fixture) {
  return fixture.elements.get('phaseList').children.map(row => ({state:row.dataset.state,
    label:row.children[1].textContent,detail:row.children[1].children[0].textContent,time:row.children[2].textContent}));
}

test('rapid transcription clicks hold one service/parse/submit operation and lock captured task parameters', async () => {
  const health=deferred();let starts=0,connections=0;
  const f=render({ensureLocalService(){connections++;return health.promise;},async startVideoTranscription(){starts++;return job;}});
  const first=f.elements.get('transcribe').emit('click');
  await settle();
  for(const id of ['link','tabs','existingAction','quality','terms','enableTerms','importTerms'])assert.equal(f.elements.get(id).disabled,true,id+' must not change the captured operation');
  await f.elements.get('transcribe').emit('click');
  assert.equal(connections,1);
  health.resolve(ready);await first;
  assert.equal(starts,1);assert.equal(f.messages.length,1);
  assert.equal(f.elements.get('link').disabled,false);
});

test('download remains independent of the local model service and never submits transcription', async () => {
  let connections=0,starts=0;
  const f=render({async ensureLocalService(){connections++;throw new Error('offline test');},async startVideoTranscription(){starts++;throw new Error('unexpected model task');}});
  await f.elements.get('start').click();
  assert.equal(connections,0);assert.equal(starts,0);assert.equal(f.downloads.length,1);
  assert.equal(f.elements.get('status').dataset.state,'complete');
});

test('polling refuses another job id even when it belongs to the same work', async () => {
  const f=render({async startVideoTranscription(){return job;},async localRequest(){return{...complete,id:'b'.repeat(32)};}});
  await f.elements.get('transcribe').click();
  assert.equal(f.elements.get('transcriptSection').hidden,true,'a wrong job must never become the current draft');
  assert.notEqual(f.elements.get('status').dataset.state,'complete');
  assert.match(f.elements.get('status').textContent,/任务|一致|匹配/);
});

test('a polling disconnect keeps the submitted task unknown and retries its GET without creating a duplicate job', async () => {
  let posts=0,polls=0;
  const f=render({async localRequest(path){
    if(path==='/videos/find')return{file:{path:'/isolated-test/a.mp4',height:720,expectedBytes:123,workId,durationMs:5000}};
    if(path==='/jobs'){posts++;return job;}
    if(path==='/jobs/'+job.id){
      if(++polls===1)throw Object.assign(new Error('本地服务连接中断'),{code:'SERVICE_UNAVAILABLE'});
      return complete;
    }
    throw new Error('unexpected request '+path);
  }});
  await f.elements.get('transcribe').click();
  assert.match(f.elements.get('status').textContent,/待确认|未确认|连接.*异常/);
  assert.equal(f.elements.get('retry').hidden,false);
  assert.equal(f.elements.get('taskProgress').dataset.state,'unknown');
  assert.equal(f.elements.get('taskProgress').open,true);
  assert.match(f.elements.get('progressSummary').textContent,/连接中断|待确认/);
  const disconnectedRows=phases(f);
  assert.ok(disconnectedRows.some(item=>item.label==='准备音频'&&item.state==='unknown'&&item.time===''));
  assert.equal(disconnectedRows.some(item=>item.label==='文案结果已返回'),false);
  const confirmed=disconnectedRows.filter(item=>item.state==='completed'||item.state==='skipped');
  assert.ok(confirmed.some(item=>item.label==='获取视频信息'));
  assert.ok(confirmed.some(item=>item.label==='本地视频'&&/已复用/.test(item.detail)&&item.time===''));
  await f.elements.get('retry').click();
  assert.equal(posts,1,'retrying observation must not POST /jobs again');
  assert.deepEqual(f.requests,['/videos/find','/jobs','/jobs/'+job.id,'/jobs/'+job.id]);
  assert.deepEqual(f.downloads,[]);
  assert.equal(f.elements.get('status').dataset.state,'complete');
  assert.equal(f.elements.get('taskProgress').dataset.state,'succeeded');
  const recoveredRows=phases(f);
  assert.ok(recoveredRows.some(item=>item.label==='文案结果已返回'&&item.state==='completed'));
  for(const row of confirmed)assert.deepEqual(recoveredRows.find(item=>item.label===row.label),row,'confirmed earlier phases must survive same-task retry');
  const recoveredAudio=recoveredRows.find(item=>item.label==='准备音频');
  assert.equal(recoveredAudio.state,'completed');assert.equal(recoveredAudio.time,'');assert.match(recoveredAudio.detail,/未记录/);
  assert.match(f.elements.get('timingNote').textContent,/耗时未知/,'a disconnect without server end time cannot acquire a whole-task duration');
});

test('a real coarse failed response preserves confirmed steps and exposes the exact backend error without guessing its phase', async () => {
  let polls=0;
  const f=render({async localRequest(path){
    if(path==='/videos/find')return{file:{path:'/isolated-test/a.mp4',height:720,expectedBytes:123,workId,durationMs:5000}};
    if(path==='/jobs')return job;
    if(path==='/jobs/'+job.id)return ++polls===1?{...job,stage:'中文模型识别与逐句时间对齐'}:
      {...job,status:'failed',stage:'失败',error:'本地处理超时，请尝试较短的视频。'};
    throw new Error('unexpected request '+path);
  }});
  await f.elements.get('transcribe').click();
  const rows=phases(f);
  assert.equal(f.elements.get('taskProgress').dataset.state,'failed');assert.equal(f.elements.get('taskProgress').open,true);
  assert.ok(rows.some(item=>item.label==='获取视频信息'&&item.state==='completed'));
  assert.ok(rows.some(item=>item.label==='本地视频'&&item.state==='skipped'&&/已复用/.test(item.detail)&&item.time===''));
  assert.ok(rows.some(item=>item.label==='中文模型识别与逐句时间对齐'&&item.state==='unknown'));
  const failed=rows.find(item=>item.state==='failed');assert.ok(failed);
  assert.match(failed.detail,/未报告具体失败步骤/);assert.match(failed.detail,/本地处理超时/);
  assert.equal(rows.some(item=>item.label==='文案结果已返回'),false);
  assert.equal(f.elements.get('transcriptSection').hidden,true);
  assert.deepEqual(f.requests,['/videos/find','/jobs','/jobs/'+job.id,'/jobs/'+job.id]);
  assert.deepEqual(f.downloads,[],'a recognition failure must preserve reuse rather than download again');
});

test('a lost POST response reports uncertain submission without exposing a blind duplicate retry', async () => {
  let posts=0;
  const f=render({async localRequest(path){
    if(path==='/videos/find')return{file:{path:'/isolated-test/a.mp4',height:720,expectedBytes:123,workId,durationMs:5000}};
    if(path==='/jobs'){posts++;throw Object.assign(new Error('响应超时'),{code:'SERVICE_UNAVAILABLE'});}
    throw new Error('unexpected boundary '+path);
  }});
  await f.elements.get('transcribe').click();
  assert.equal(posts,1);assert.match(f.elements.get('status').textContent,/待确认|未确认/);
  await f.elements.get('retry').click();
  assert.equal(posts,1,'a POST may already have started inference; do not blindly resubmit');
  assert.equal(f.elements.get('transcriptSection').hidden,true);
});

test('running status uses the real backend stage and tolerates absent start time without inventing NaN elapsed seconds', async () => {
  const finish=deferred();let polls=0;
  const f=render({async startVideoTranscription(){return job;},async localRequest(){return ++polls===1?{...job,stage:'中文模型识别与逐句时间对齐',startedAt:undefined}:finish.promise;}});
  const operation=f.elements.get('transcribe').click();await until(()=>polls===2);
  assert.match(f.elements.get('status').textContent,/中文模型识别与逐句时间对齐/);
  assert.doesNotMatch(f.elements.get('status').textContent,/NaN|\d+%/);
  finish.resolve(complete);await operation;
});

test('a slower earlier source-list refresh cannot replace a later explicit source choice', async () => {
  const initial=deferred();let queries=0;
  const later={id:42,url:workURL,title:'最新选择'};
  const stale={id:7,url:'https://www.douyin.com/video/1111111111111111111',title:'迟到列表'};
  const f=render({}, {query(){return ++queries===1?initial.promise:Promise.resolve([later]);}});
  await f.elements.get('refresh').click();
  assert.equal(f.elements.get('tabs').value,'42');
  initial.resolve([stale]);await settle();
  assert.equal(f.elements.get('tabs').value,'42');
  assert.deepEqual(f.elements.get('tabs').options.map(option=>option.value),['42']);
});

const nextJob = {...complete,id:'b'.repeat(32),title:'新完成的隔离结果',text:'新结果第一句。\n新结果第二句。',
  reviewSegments:[{id:0,startMs:100,endMs:1500,text:'新结果第一句。'},{id:1,startMs:2000,endMs:4000,text:'新结果第二句。'}]};
test('a completed async result is staged instead of replacing a saved manually edited current draft', async () => {
  const f=render({async startVideoTranscription(){return{...job,id:nextJob.id};},async localRequest(){return nextJob;}},{saved:cache()});
  const field=f.elements.get('transcriptText'), previous=field.value;
  await f.elements.get('transcribe').click();
  assert.equal(field.value,previous,'completion must not overwrite the manually edited draft');
  assert.equal(f.elements.get('pendingResultNotice').hidden,false);
  assert.equal(f.elements.get('applyResult').disabled,false);
  await f.elements.get('applyResult').click();
  assert.equal(field.value,nextJob.text);
  assert.equal(f.elements.get('pendingResultNotice').hidden,true);
  assert.equal(JSON.parse(f.saved.get('draft-v1-'+complete.id)).blocks[0].text,'人工修改仍需保留。');
});

test('applying a pending result refuses to discard a current draft when its safety save fails', async () => {
  const f=render({async startVideoTranscription(){return{...job,id:nextJob.id};},async localRequest(){return nextJob;}},{saved:cache()});
  const field=f.elements.get('transcriptText');
  await f.elements.get('transcribe').click();
  f.failWrites.add('draft-v1-'+complete.id);
  field.value='刚刚输入但暂未保存。\n原始第二句。';await field.emit('input');
  await f.elements.get('applyResult').click();
  assert.equal(field.value,'刚刚输入但暂未保存。\n原始第二句。');
  assert.equal(f.elements.get('pendingResultNotice').hidden,false);
  assert.match(f.elements.get('saveState').textContent,/失败/);
  await f.elements.get('copy').click();assert.equal(f.copied.at(-1),field.value);
  f.failWrites.clear();await f.elements.get('applyResult').click();
  assert.equal(field.value,nextJob.text);
});

test('completion and apply never interrupt an active Chinese composition', async () => {
  const finish=deferred();
  const f=render({async startVideoTranscription(){return{...job,id:nextJob.id};},async localRequest(){return finish.promise;}},{saved:cache()});
  const field=f.elements.get('transcriptText');
  const operation=f.elements.get('transcribe').click();await until(()=>f.requests.length===1);
  await field.emit('compositionstart');field.value='正在拼音输入。\n原始第二句。';
  await field.emit('input',{isComposing:true});finish.resolve(nextJob);await operation;
  assert.equal(field.value,'正在拼音输入。\n原始第二句。');
  assert.equal(f.elements.get('pendingResultNotice').hidden,false);
  await f.elements.get('applyResult').click();
  assert.equal(field.value,'正在拼音输入。\n原始第二句。');
  await field.emit('compositionend');
  await f.elements.get('copy').click();assert.equal(f.copied.at(-1),field.value);
  await f.elements.get('applyResult').click();assert.equal(field.value,nextJob.text);
});

test('repeatedly opening review while audio loads shares one request and a closed review stays paused', async () => {
  const sound=deferred();
  const f=render({async localAudio(){return sound.promise;}},{saved:cache()});
  const details=f.elements.get('reviewDetails');
  assert.equal(f.elements.get('reviewAudio').hidden,true,'a restored transcript must not expose an empty audio player');
  details.open=true;const opening=details.emit('toggle');await until(()=>f.audio.length===1);
  assert.equal(f.elements.get('reviewAudio').hidden,true,'the native player stays hidden while its audio blob is pending');
  details.open=false;await details.emit('toggle');details.open=true;const reopening=details.emit('toggle');
  await settle();assert.equal(f.audio.length,1,'same-job audio must not duplicate inflight requests');
  assert.equal(f.elements.get('reviewAudio').hidden,true);
  details.open=false;await details.emit('toggle');sound.resolve(new Blob(['isolated audio']));await Promise.all([opening,reopening]);await settle();
  assert.equal(details.open,false);
  assert.equal(f.elements.get('playSegment').disabled,true,'late audio should not activate a collapsed review');
  assert.equal(f.elements.get('reviewAudio').hidden,true,'a stale response for a collapsed review must not expose its player');
  assert.equal(f.elements.get('reviewAudio').src,undefined);
  details.open=true;await details.emit('toggle');await until(()=>Boolean(f.elements.get('reviewAudio').src));
  const readySource=f.elements.get('reviewAudio').src;
  assert.equal(f.elements.get('reviewAudio').hidden,false);assert.equal(f.elements.get('playSegment').disabled,false);
  assert.equal(await f.objectURLs.get(readySource).text(),'isolated audio');
  const requestsBeforeCachedOpen=f.audio.length;
  details.open=false;await details.emit('toggle');details.open=true;await details.emit('toggle');
  assert.equal(f.elements.get('reviewAudio').hidden,false);assert.equal(f.elements.get('reviewAudio').src,readySource);
  assert.equal(f.audio.length,requestsBeforeCachedOpen,'opening cached audio should reuse the validated blob');
});

test('audio failure preserves the draft and hides the empty player until a successful retry returns a blob', async () => {
  const sound=deferred();let loads=0;
  const f=render({async localAudio(){return ++loads===1?sound.promise:new Blob(['retry audio']);}},{saved:cache()});
  const current=f.elements.get('transcriptText').value,details=f.elements.get('reviewDetails');
  details.open=true;await details.emit('toggle');await until(()=>f.audio.length===1);
  assert.equal(f.elements.get('reviewAudio').hidden,true);assert.equal(f.elements.get('playSegment').disabled,true);
  sound.reject(new Error('测试音频加载失败'));
  await until(()=>f.elements.get('audioState').textContent==='测试音频加载失败');
  assert.equal(f.elements.get('reviewAudio').hidden,true);assert.equal(f.elements.get('reviewAudio').src,undefined);
  assert.equal(f.elements.get('playSegment').disabled,true);assert.equal(f.elements.get('transcriptText').value,current);
  details.open=false;await details.emit('toggle');details.open=true;await details.emit('toggle');
  await until(()=>Boolean(f.elements.get('reviewAudio').src));
  assert.equal(f.audio.length,2);assert.equal(f.elements.get('reviewAudio').hidden,false);
  assert.equal(await f.objectURLs.get(f.elements.get('reviewAudio').src).text(),'retry audio');
  assert.equal(f.elements.get('transcriptText').value,current);
});

test('a task without review audio never exposes a broken player or starts an audio request', async () => {
  const saved=cache();saved.set('result-v1-'+complete.id,JSON.stringify({...complete,hasAudio:false}));
  const f=render({}, {saved}),details=f.elements.get('reviewDetails');
  details.open=true;await details.emit('toggle');await settle();
  assert.equal(f.elements.get('reviewAudio').hidden,true);assert.equal(f.elements.get('reviewAudio').src,undefined);
  assert.equal(f.elements.get('playSegment').disabled,true);assert.match(f.elements.get('audioState').textContent,/没有可用的回听音频/);
  assert.deepEqual(f.audio,[]);assert.equal(f.elements.get('transcriptText').value,'人工修改仍需保留。\n原始第二句。');
});

test('page disposal ignores late job completion and prevents any new operation', async () => {
  const finish=deferred();let starts=0;
  const f=render({async startVideoTranscription(){starts++;return job;},async localRequest(){return finish.promise;}});
  const operation=f.elements.get('transcribe').click();await until(()=>f.requests.length===1);
  const statusBefore=f.elements.get('status').textContent;
  f.dispatchWindow('pagehide',{persisted:false});finish.resolve(complete);await operation;
  assert.equal(f.elements.get('transcriptSection').hidden,true);
  assert.equal(f.elements.get('status').textContent,statusBefore,'disposed UI must ignore completion');
  await f.elements.get('transcribe').emit('click');
  assert.equal(starts,1);assert.equal(f.messages.length,1);
});

test('ambiguous multiple links fail before touching service, parser, downloads or jobs', async () => {
  let connections=0,starts=0;
  const f=render({async ensureLocalService(){connections++;return ready;},async startVideoTranscription(){starts++;return job;}});
  f.elements.get('link').value=workURL+' 和 https://www.douyin.com/video/1111111111111111111';
  await f.elements.get('transcribe').click();
  assert.match(f.elements.get('status').textContent,/多个链接/);
  assert.equal(connections,0);assert.equal(starts,0);assert.deepEqual(f.messages,[]);assert.deepEqual(f.downloads,[]);
});

test('restoring the already current job preserves edited text, selection and open review', async () => {
  const f=render({}, {saved:cache()});const field=f.elements.get('transcriptText');
  const previous=field.value;field.focus();field.selectionStart=2;field.selectionEnd=6;
  f.elements.get('reviewDetails').open=true;
  await f.elements.get('resume').click();
  assert.equal(field.value,previous);assert.equal(field.selectionStart,2);assert.equal(field.selectionEnd,6);
  assert.equal(f.elements.get('reviewDetails').open,true);
  assert.equal(f.elements.get('pendingResultNotice').hidden,true);
  assert.deepEqual(f.requests,['/jobs/'+complete.id]);
});

test('cached result identity must match the stored reference even for the same work', () => {
  const saved=cache();saved.set('result-v1-'+complete.id,JSON.stringify({...complete,id:'b'.repeat(32)}));
  const f=render({}, {saved});
  assert.equal(f.elements.get('transcriptSection').hidden,true);
  assert.match(f.elements.get('status').textContent,/无法读取|不一致/);
  assert.equal(JSON.parse(saved.get('lastCompleted-v1')).id,complete.id,'rejected cache must not rewrite its reference');
});

test('late audio from an older job cannot replace or revoke the newer job audio', async () => {
  const oldAudio=deferred();
  const f=render({async startVideoTranscription(){return{...job,id:nextJob.id};},async localRequest(){return nextJob;},
    async localAudio(id){return id===complete.id?oldAudio.promise:new Blob(['new job audio']);}},{saved:cache()});
  const details=f.elements.get('reviewDetails');details.open=true;const oldLoading=details.emit('toggle');
  await until(()=>f.audio.length===1);
  assert.equal(f.elements.get('reviewAudio').hidden,true);
  await f.elements.get('transcribe').click();await f.elements.get('applyResult').click();
  assert.equal(f.elements.get('reviewAudio').hidden,true,'changing drafts must remove the previous empty or ready player');
  details.open=true;await details.emit('toggle');await until(()=>f.audio.length===2);
  await settle();const newSource=f.elements.get('reviewAudio').src;
  assert.ok(newSource);assert.equal(await f.objectURLs.get(newSource).text(),'new job audio');
  assert.equal(f.elements.get('reviewAudio').hidden,false);
  oldAudio.resolve(new Blob(['late old job audio']));await oldLoading;await settle();
  assert.equal(f.elements.get('reviewAudio').src,newSource);
  assert.equal(f.elements.get('reviewAudio').hidden,false,'an older response cannot hide the newer ready player');
  assert.equal(await f.objectURLs.get(newSource).text(),'new job audio');
});

test('an uncertain submission permits another POST only after explicit acknowledgment and a new extract action', async () => {
  let posts=0;
  const f=render({async localRequest(path){
    if(path==='/videos/find')return{file:{path:'/isolated-test/a.mp4',height:720,expectedBytes:123,workId,durationMs:5000}};
    if(path==='/jobs'){if(++posts===1)throw Object.assign(new Error('response lost'),{code:'SERVICE_UNAVAILABLE'});return job;}
    return complete;
  }});
  await f.elements.get('transcribe').click();
  assert.equal(f.elements.get('transcribe').disabled,true);
  assert.equal(f.elements.get('submissionNotice').hidden,false);
  await f.elements.get('acknowledgeSubmission').click();
  assert.equal(posts,1,'acknowledging uncertainty must not itself submit a job');
  assert.equal(f.elements.get('transcribe').disabled,false);
  await f.elements.get('transcribe').click();assert.equal(posts,2);
  assert.equal(f.elements.get('transcriptText').value,complete.text);
});

test('a source revision during delayed completion stages the result and keeps the newer source untouched', async () => {
  const finish=deferred();
  const f=render({async startVideoTranscription(){return job;},async localRequest(){return finish.promise;}});
  const operation=f.elements.get('transcribe').click();await until(()=>f.requests.length===1);
  f.elements.get('link').value='https://www.douyin.com/video/1111111111111111111';
  await f.elements.get('link').emit('input');
  const progressBefore=f.elements.get('progressSummary').textContent,statusBefore=f.elements.get('status').textContent;
  finish.resolve(complete);await operation;
  assert.equal(f.elements.get('transcriptSection').hidden,true);
  assert.equal(f.elements.get('result').hidden,true,'late metadata should not relabel the newer selected source');
  assert.equal(f.elements.get('pendingResultNotice').hidden,false);
  assert.equal(f.elements.get('link').value,'https://www.douyin.com/video/1111111111111111111');
  assert.equal(f.elements.get('taskProgress').hidden,true,'A completion must not reopen progress for B');
  assert.equal(f.elements.get('progressSummary').textContent,progressBefore,'A completion must not relabel the progress summary');
  assert.equal(f.elements.get('status').textContent,statusBefore,'A completion must not overwrite the generic status for B');
});

test('a late running phase from A cannot update the timeline or status after the source changes to B', async () => {
  const delayedStage=deferred(),finish=deferred();let polls=0;
  const f=render({async startVideoTranscription(){return job;},async localRequest(){return ++polls===1?delayedStage.promise:finish.promise;}});
  const operation=f.elements.get('transcribe').click();await until(()=>polls===1);
  assert.equal(f.elements.get('taskProgress').hidden,false);
  f.elements.get('link').value='https://www.douyin.com/video/1111111111111111111';await f.elements.get('link').emit('input');
  const rowsBefore=phases(f),statusBefore=f.elements.get('status').textContent;
  delayedStage.resolve({...job,stage:'中文模型识别与逐句时间对齐'});await until(()=>polls===2);
  assert.equal(f.elements.get('taskProgress').hidden,true);assert.deepEqual(phases(f),rowsBefore);
  assert.equal(f.elements.get('status').textContent,statusBefore,'late A running status must not describe B');
  assert.equal(f.elements.get('result').hidden,true);assert.equal(f.elements.get('coverImage').hidden,true);
  assert.equal(f.elements.get('transcriptSection').hidden,true);
  finish.resolve(complete);await operation;
  assert.equal(f.elements.get('taskProgress').hidden,true);assert.deepEqual(phases(f),rowsBefore);
  assert.equal(f.elements.get('status').textContent,statusBefore,'A completion must not overwrite the generic status for B');
  assert.equal(f.elements.get('transcriptSection').hidden,true,'A completion must remain pending instead of overwriting B');
});

test('a delayed same-job restore of cached A cannot relabel B status or disturb the current draft', async () => {
  const finish=deferred();
  const f=render({async localRequest(){return finish.promise;}},{saved:cache()});
  const current=f.elements.get('transcriptText').value;
  const operation=f.elements.get('resume').click();await until(()=>f.requests.length===1);
  f.elements.get('link').value='https://www.douyin.com/video/1111111111111111111';await f.elements.get('link').emit('input');
  const statusBefore=f.elements.get('status').textContent;
  finish.resolve(complete);await operation;
  assert.equal(f.elements.get('status').textContent,statusBefore,'the same-job early return must also respect the current source revision');
  assert.equal(f.elements.get('taskProgress').hidden,true);
  assert.equal(f.elements.get('transcriptText').value,current);
  assert.deepEqual(f.requests,['/jobs/'+job.id]);
});

test('a delayed restore connection callback for A cannot overwrite status after switching the source to B', async () => {
  const connection=deferred();let onState;
  const f=render({ensureLocalService(options){onState=options.onState;return connection.promise;}},{saved:cache()});
  const current=f.elements.get('transcriptText').value;
  const operation=f.elements.get('resume').click();await until(()=>typeof onState==='function');
  onState('正在连接作品 A 的本地助手');
  assert.equal(f.elements.get('status').textContent,'正在连接作品 A 的本地助手','the callback should work while A is current');
  f.elements.get('link').value='https://www.douyin.com/video/1111111111111111111';await f.elements.get('link').emit('input');
  const statusBefore=f.elements.get('status').textContent;
  onState('作品 A 的迟到连接消息');
  assert.equal(f.elements.get('status').textContent,statusBefore);
  assert.equal(f.elements.get('taskProgress').hidden,true);
  connection.resolve(ready);await operation;
  assert.equal(f.elements.get('status').textContent,statusBefore);
  assert.equal(f.elements.get('transcriptText').value,current);
  assert.deepEqual(f.requests,['/jobs/'+job.id]);
  assert.deepEqual(f.messages,[]);assert.deepEqual(f.downloads,[]);
});

test('a failed submitted-task reference stays recoverable in this page without claiming it survived reopening', async () => {
  const f=render({async startVideoTranscription(){return{...job,id:nextJob.id};},async localRequest(){return nextJob;}},
    {saved:cache(),failWrites:['lastTranscription']});
  const previous=f.elements.get('transcriptText').value;
  await f.elements.get('transcribe').click();
  assert.equal(f.elements.get('pendingResultNotice').hidden,false);
  assert.equal(JSON.parse(f.saved.get('lastTranscription')).id,complete.id);
  await f.elements.get('dismissResult').click();
  assert.equal(f.elements.get('transcriptText').value,previous);
  assert.match(f.elements.get('status').textContent,/本页/);
  assert.match(f.elements.get('status').textContent,/未保存|尚未保存/);
  await f.elements.get('resume').click();
  assert.deepEqual(f.requests,['/jobs/'+nextJob.id,'/jobs/'+nextJob.id],'restore must prefer the in-memory new reference');
  assert.equal(f.elements.get('pendingResultNotice').hidden,false);
  assert.equal(f.elements.get('transcriptText').value,previous);
});

for(const failingKey of ['result-v1-'+nextJob.id,'lastCompleted-v1']) {
  test(`incomplete offline recovery storage remains unsaved until both cache and reference persist (${failingKey.split('-v1')[0]})`, async () => {
    const oldRef=JSON.stringify({id:complete.id,workId});
    const saved=new Map([['lastCompleted-v1',oldRef]]);
    const f=render({async startVideoTranscription(){return{...job,id:nextJob.id};},async localRequest(){return nextJob;}},
      {saved,failWrites:[failingKey]});
    await f.elements.get('transcribe').click();
    assert.equal(f.elements.get('transcriptText').value,nextJob.text);
    assert.match(f.elements.get('saveState').textContent,/失败/);
    assert.equal(saved.get('lastCompleted-v1'),oldRef,'a failed prerequisite must preserve the previous recoverable reference');
    const field=f.elements.get('transcriptText');field.value='编辑后仍未全部保存。\n新结果第二句。';await field.emit('input');
    assert.ok(saved.has('draft-v1-'+nextJob.id),'saving only the draft key is insufficient for offline recovery');
    assert.match(f.elements.get('saveState').textContent,/失败/);
    assert.equal(saved.get('lastCompleted-v1'),oldRef);
    f.failWrites.clear();field.value='保存能力恢复后的当前稿。\n新结果第二句。';await field.emit('input');
    assert.match(f.elements.get('saveState').textContent,/已保存在本机/);
    assert.equal(JSON.parse(saved.get('lastCompleted-v1')).id,nextJob.id);
    assert.equal(JSON.parse(saved.get('result-v1-'+nextJob.id)).id,nextJob.id);
    const reopened=render({}, {saved});
    assert.equal(reopened.elements.get('transcriptText').value,field.value);
  });
}

for(const failure of [
  {name:'malformed JSON response',error:new SyntaxError('invalid JSON')},
  {name:'raw fetch TypeError',error:new TypeError('failed to fetch')},
  {name:'raw fetch AbortError',error:Object.assign(new Error('timeout'),{name:'AbortError'})},
  {name:'missing task data',response:{}},
  {name:'another work in successful response',response:{...job,workId:'1111111111111111111'}},
  {name:'invalid task state in successful response',response:{...job,status:'unknown'}}
]) {
  test(`uncertain POST outcome blocks blind retry for ${failure.name}`, async () => {
    let posts=0;
    const f=render({async localRequest(path){
      if(path==='/videos/find')return{file:{path:'/isolated-test/a.mp4',height:720,expectedBytes:123,workId,durationMs:5000}};
      if(path==='/jobs'){posts++;if(failure.error)throw failure.error;return failure.response;}
      throw new Error('unexpected poll after an invalid submission result');
    }});
    await f.elements.get('transcribe').click();
    assert.equal(posts,1);assert.match(f.elements.get('status').textContent,/待确认|未确认/);
    assert.equal(f.elements.get('submissionNotice').hidden,false);
    assert.equal(f.elements.get('retry').hidden,true);
    assert.equal(f.elements.get('transcribe').disabled,true);
    await f.elements.get('retry').emit('click');await f.elements.get('transcribe').emit('click');
    assert.equal(posts,1);
    assert.equal(f.elements.get('transcriptSection').hidden,true);
  });
}

for(const fieldId of ['transcriptText','segmentText']) {
  test(`pagehide best-effort saves the visible pending composition before disposing (${fieldId})`, async () => {
    const f=render({}, {saved:cache()});const field=f.elements.get(fieldId);
    const key='draft-v1-'+complete.id, persistedBefore=f.saved.get(key);
    field.selectionStart=0;field.selectionEnd=field.value.length;
    await field.emit('compositionstart');
    field.value=fieldId==='transcriptText'?'离开前仍在组合的中文。\n原始第二句。':'离开前仍在组合的中文。';
    await field.emit('input',{isComposing:true});
    assert.equal(f.saved.get(key),persistedBefore,'intermediate IME input is not a normal persisted edit');
    f.dispatchWindow('pagehide',{persisted:false});
    const expected='离开前仍在组合的中文。\n原始第二句。';
    assert.equal(JSON.parse(f.saved.get(key)).blocks.map(block=>block.text).join('\n'),expected);
    const reopened=render({}, {saved:f.saved});
    assert.equal(reopened.elements.get('transcriptText').value,expected);
    assert.deepEqual(f.messages,[]);assert.deepEqual(f.requests,[]);
  });
}

test('restoring an unrelated failed job never retries the previous source operation', async () => {
  let starts=0;
  const unrelated={id:'b'.repeat(32),workId:'1111111111111111111'};
  const f=render({async startVideoTranscription(){starts++;return job;},async localRequest(path){
    return path.endsWith(unrelated.id)?{...unrelated,status:'failed',error:'另一个任务识别失败'}:complete;
  }});
  await f.elements.get('transcribe').click();
  assert.equal(starts,1);assert.equal(f.elements.get('transcriptText').value,complete.text);
  f.saved.set('lastTranscription',JSON.stringify(unrelated));
  await f.elements.get('resume').click();
  assert.match(f.elements.get('status').textContent,/另一个任务识别失败/);
  assert.equal(f.elements.get('retry').hidden,true,'the failed ref has no matching operation to resubmit');
  await f.elements.get('retry').emit('click');
  assert.equal(starts,1);assert.equal(f.messages.length,1);
  assert.equal(f.elements.get('transcriptText').value,complete.text);
  assert.deepEqual(f.requests,['/jobs/'+job.id,'/jobs/'+unrelated.id]);
});
