import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {localRequest, checkJob} from '../../outputs/douyin-independent-extension/transcription.mjs';
import {startVideoTranscription} from '../../outputs/douyin-independent-extension/video.mjs';

const script = fs.readFileSync(new URL('../ui-preview/fixture.js', import.meta.url),'utf8');
function load(query = '', origin = 'http://127.0.0.1:4176') {
  class Storage {
    values = new Map();
    getItem(key) { return this.values.get(String(key)) ?? null; }
    setItem(key,value) { this.values.set(String(key),String(value)); }
    removeItem(key) { this.values.delete(String(key)); }
  }
  const localStorage = new Storage(), calls = [], nodes = [], listeners = new Map();
  const url = new URL('/tool.html' + query, origin);
  const document = {addEventListener:(name,fn)=>listeners.set(name,fn),
    createElement:tag=>({tag}),body:{prepend:node=>nodes.push(node)},head:{append:node=>nodes.push(node)}};
  const context = {URL,Response,DOMException,Storage,localStorage,location:url,document,
    addEventListener(){},fetch:async(...args)=>{calls.push(args);return new Response('same-origin fixture');}};
  context.window = context;
  vm.runInNewContext(script,context,{filename:'fixture.js'});
  listeners.get('DOMContentLoaded')?.();
  return {...context,calls,nodes};
}
const requestFor = fixture => (path,payload) => localRequest(path,payload,fixture.fetch);
async function resolveWork(fixture, index = 0) {
  const tabs = await fixture.chrome.tabs.query({url:'https://www.douyin.com/*'});
  const result = await fixture.chrome.runtime.sendMessage({action:'resolve-douyin',existingTabId:tabs[index].id});
  assert.equal(result.ok,true); return result.work;
}
async function submit(fixture, index = 0) {
  const work = await resolveWork(fixture,index);
  const job = await startVideoTranscription(work,720,'',{request:requestFor(fixture),download:async()=>assert.fail('fixture reuse must not download')});
  return {work,job};
}

test('baseline fixture stays offline and every visible banner identifies isolated test data', async () => {
  for (const query of ['?state=complete','?state=empty']) {
    const fixture = load(query);
    assert.equal((await fixture.chrome.tabs.query({})).length,0);
    await assert.rejects(fixture.fetch('http://127.0.0.1:8766/health'),error=>error.name==='TypeError');
    assert.equal(fixture.calls.length,0);
    assert.match(fixture.nodes[0].textContent,/隔离 UI 测试.*无真实下载.*本地服务/);
    assert.equal(Boolean(fixture.localStorage.getItem('lastCompleted-v1')),query.includes('complete'));
  }
});

test('success fixture uses two labelled sources, reuse and a different result ID without native endpoints', async () => {
  const fixture = load('?state=complete&scenario=success');
  const tabs = await fixture.chrome.tabs.query({});
  assert.equal(tabs.length,2); assert.ok(tabs.every(tab=>tab.title.includes('隔离测试')));
  const ready = await requestFor(fixture)('/health'); assert.equal(ready.ready,true);
  const {work,job} = await submit(fixture);
  assert.equal(job.id,'e'.repeat(32)); assert.notEqual(job.id,'f'.repeat(32));
  for (let index=0;index<2;index++) {
    const pending = checkJob(await requestFor(fixture)('/jobs/'+job.id),work.id);
    assert.equal(pending.status,'running'); assert.match(pending.stage,/隔离测试/);
  }
  const complete = checkJob(await requestFor(fixture)('/jobs/'+job.id),work.id);
  assert.equal(complete.status,'complete'); assert.match(complete.text,/隔离测试新结果/);
  const details = fixture.ClipQuillFixture.inspect();
  assert.equal(details.submissions,1); assert.equal(details.polls,3);
  assert.equal(details.nativeAttempts,0); assert.equal(details.downloadAttempts,0);
  assert.equal(fixture.calls.length,0);
});

test('poll-error fixture fails only the first GET and retry returns the same task without another POST', async () => {
  const fixture = load('?state=complete&scenario=poll-error');
  const {job} = await submit(fixture);
  await assert.rejects(requestFor(fixture)('/jobs/'+job.id),error=>error.code==='SERVICE_UNAVAILABLE');
  const result = await requestFor(fixture)('/jobs/'+job.id);
  assert.equal(result.id,job.id); assert.equal(result.status,'complete');
  assert.equal(fixture.ClipQuillFixture.inspect().submissions,1);
  assert.equal(fixture.ClipQuillFixture.inspect().polls,2); assert.equal(fixture.calls.length,0);
});

test('running and failed visual scenarios are isolated and report explicit test stages', async () => {
  for (const scenario of ['running','failed']) {
    const fixture=load('?state=complete&scenario='+scenario);
    const {job}=await submit(fixture);
    await requestFor(fixture)('/jobs/'+job.id);
    const result=await requestFor(fixture)('/jobs/'+job.id);
    assert.equal(result.status,scenario === 'running' ? 'running' : 'failed');
    assert.match(result.error || result.stage,/隔离测试/);
    assert.equal(fixture.ClipQuillFixture.inspect().submissions,1);
    assert.equal(fixture.calls.length,0);
  }
});

test('submit-unknown fixture rejects POST once and does not cause automatic source redownload or resubmission', async () => {
  const fixture = load('?state=complete&scenario=submit-unknown');
  await assert.rejects(submit(fixture),error=>error.code==='SERVICE_UNAVAILABLE');
  const details = fixture.ClipQuillFixture.inspect();
  assert.equal(details.submissions,1); assert.equal(details.polls,0); assert.equal(details.downloadAttempts,0);
  assert.equal(details.submittedJobId,'e'.repeat(32)); assert.equal(fixture.calls.length,0);
});

test('storage-error fixture only rejects draft writes on its own isolated HTTP storage', () => {
  const fixture = load('?state=complete&scenario=storage-error');
  assert.throws(()=>fixture.localStorage.setItem('draft-v1-'+'f'.repeat(32),'{}'),error=>error.name==='QuotaExceededError');
  fixture.localStorage.setItem('result-v1-test','cached');
  fixture.localStorage.setItem('preview.chrome.clipquill.ui.theme.v1','"dark"');
  assert.equal(fixture.localStorage.getItem('result-v1-test'),'cached');
  const other = new fixture.Storage(); other.setItem('draft-v1-other','unaffected');
  assert.equal(other.getItem('draft-v1-other'),'unaffected');
  assert.throws(()=>load('?scenario=storage-error','chrome-extension://test-extension'),/只能运行在隔离/);
});

test('fixture blocks outside fetch, native messaging and actual video downloads', async () => {
  const fixture = load('?scenario=success');
  await assert.rejects(requestFor(fixture)('/not-implemented'),error=>error.code==='FIXTURE_UNSUPPORTED');
  const unknown = await fixture.fetch(new Request('http://127.0.0.1:8766/not-implemented'));
  assert.equal(unknown.status,404); assert.equal((await unknown.json()).code,'FIXTURE_UNSUPPORTED');
  await assert.rejects(fixture.fetch('https://www.douyin.com/video/1000000000000000001'),error=>error.name==='TypeError');
  await assert.rejects(fixture.chrome.runtime.sendNativeMessage(),/不会启动/);
  await assert.rejects(fixture.chrome.downloads.download({}),/不下载真实视频/);
  assert.equal(fixture.calls.length,0);
  await fixture.fetch('/fixture.css'); assert.equal(fixture.calls.length,1);
});
