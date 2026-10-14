import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as core from '../../outputs/douyin-independent-extension/core.mjs';
import * as transcription from '../../outputs/douyin-independent-extension/transcription.mjs';
import * as video from '../../outputs/douyin-independent-extension/video.mjs';
import * as review from '../../outputs/douyin-independent-extension/review.mjs';
import * as draft from '../../outputs/douyin-independent-extension/draft.mjs';
import * as settings from '../../outputs/douyin-independent-extension/settings.mjs';
import * as service from '../../outputs/douyin-independent-extension/service.mjs';
import * as editor from '../../outputs/douyin-independent-extension/editor.mjs';

const directory = new URL('../../outputs/douyin-independent-extension/', import.meta.url);
const html = readFileSync(new URL('tool.html',directory),'utf8');
const source = readFileSync(new URL('tool.js',directory),'utf8').replace(/^import .*;\n/gm,'');
const id = '7689864994510343451', url = `https://www.douyin.com/video/${id}`;
function render(saved = new Map(), response = {ok:true,tabId:10}, overrides = {}, fixture = {}) {
  const elements = new Map(), messages = [], focus = [], queries = [], downloads = [], copied = [], exports = [], writes = [];
  const objectURLs = new Map(), failWrites = new Set(fixture.failWrites || []);
  for (const match of html.matchAll(/\bid="([^"]+)"[^>]*>/g)) {
    const handlers = new Map();
    elements.set(match[1], {hidden: /\bhidden\b/.test(match[0]), disabled: false, checked: false, open: false,
      value: '', textContent: '', dataset: {}, options: [], handlers, selectionStart: 0, selectionEnd: 0,
      addEventListener(name, listener) { handlers.set(name, [...handlers.get(name) || [], listener]); },
      async emit(name, event = {}) { for (const listener of handlers.get(name) || []) await listener(event); },
      async click() { if (!this.disabled) return this.emit('click'); },
      replaceChildren(...children) { this.options = children; this.value = children[0]?.value || ''; },
      append(child) { this.options.push(child); if (this.options.length === 1) this.value = child.value; },
      focus() { focus.push(match[1]); }, select() { this.selectionStart = 0; this.selectionEnd = this.value.length; },
      scrollIntoView() {}, pause() {}, load() {}, removeAttribute(name) { delete this[name]; }
    });
  }
  elements.get('quality').value = '720';
  elements.get('existingAction').value = 'transcribe';
  const document = {getElementById: name => elements.get(name), createElement: tag => tag === 'a'
    ? {click() { exports.push({filename:this.download, blob:objectURLs.get(this.href)}); }} : {}};
  const localStorage = {getItem: key => saved.get(key) ?? null, setItem(key,value) {
    if (failWrites.has(key)) throw new Error('fixture storage full');
    writes.push(key); saved.set(key,value);
  }, removeItem: key => saved.delete(key)};
  const chrome = {
    runtime: {getManifest() { return {version:'0.1.5'}; }, async sendMessage(value) { messages.push(value); return typeof response === 'function' ? response(value) : response; }},
    tabs: {async query(value) { queries.push(value); return fixture.tabs || []; }, async create() { throw new Error('tool must not create parser tabs directly'); }, async update(tabId,value) { focus.push({tabId,...value}); return {windowId:2}; }},
    windows: {async update() {}},
    downloads: {onChanged: {addListener() {}}, async download(value) { downloads.push(value); return 1; }, async search() { return [{state:'complete',fileSize:123,filename:'/downloads/a.mp4'}]; }}
  };
  class FixtureURL extends URL {
    static createObjectURL(blob) { const value = 'blob:fixture-' + objectURLs.size; objectURLs.set(value,blob); return value; }
    static revokeObjectURL(value) { objectURLs.delete(value); }
  }
  const navigator = {clipboard:{async writeText(text) {
    if (fixture.clipboardError) throw new Error('fixture clipboard unavailable');
    copied.push(text);
  }}};
  const timers = (...args) => { const timer = setTimeout(...args); timer.unref?.(); return timer; };
  vm.runInNewContext(source,{...core,...transcription,...video,...review,...draft,...settings,...service,...editor,...overrides,
    document,localStorage,chrome,navigator,Blob,URL:FixtureURL,setTimeout:timers,clearTimeout,console}, {filename:'tool.js'});
  return {elements,messages,focus,saved,queries,downloads,copied,exports,writes,failWrites};
}
test('first-use login advice is visible without opening any page; dismiss survives reopening', async () => {
  const f = render();
  assert.equal(f.elements.get('loginTip').hidden,false); assert.deepEqual(f.messages,[]);
  await f.elements.get('dismissLoginTip').click();
  assert.equal(f.elements.get('loginTip').hidden,true);
  assert.equal(render(f.saved).elements.get('loginTip').hidden,true);
});
test('transcription startup failure offers a retry that keeps the original link and continues automatically', async () => {
  const events = [];
  const work = {id,title:'test',durationMs:1000,variants:[{width:1280,height:720,size:123,format:'mp4',isH265:0,urls:['https://v3-dy-o.zjcdn.com/test.mp4']}]};
  let attempts = 0;
  const f = render(new Map(),message => { events.push('parse'); return {ok:true,tabId:10,work}; },{
    async ensureLocalService() {
      events.push('ensure');
      assert.equal(f.elements.get('serviceStatus').dataset.state,'waiting');
      if (++attempts === 1) throw Object.assign(new Error('本地助手启动失败'),{serviceStartup:true});
    },
    async startVideoTranscription() { events.push('transcribe'); throw new Error('stop fixture after job submission'); }
  });
  f.elements.get('link').value = url;
  await f.elements.get('transcribe').click();
  assert.equal(f.elements.get('retry').hidden,false);
  assert.equal(f.elements.get('retry').textContent,'重试启动并提取');
  assert.equal(f.elements.get('serviceStatus').dataset.state,'error');
  assert.match(f.elements.get('serviceStatus').textContent,/连接未确认/);
  assert.deepEqual(events,['ensure']);
  f.elements.get('link').value = 'https://www.douyin.com/video/1111111111111111111';
  await f.elements.get('retry').click();
  assert.deepEqual(events,['ensure','ensure','parse','transcribe']);
  assert.equal(f.messages[0].url,url);
  assert.equal(f.elements.get('retry').textContent,'重试本次操作');
  assert.equal(f.elements.get('serviceStatus').dataset.state,'complete');
  assert.match(f.elements.get('serviceStatus').textContent,/已连接/);
});
test('login opens only on an explicit first-use button click', async () => {
  const f = render();
  await f.elements.get('loginDouyin').click();
  assert.equal(f.messages.length,1); assert.equal(f.messages[0].action,'login-douyin');
  assert.match(f.elements.get('loginTipState').textContent,/自行登录/);
  assert.equal(f.elements.get('loginTip').hidden,false);
});
test('download routes through the manager without treating the login advice as a requirement', async () => {
  const work = {id,title:'test',durationMs:1000,variants:[{width:1280,height:720,size:123,format:'mp4',isH265:0,urls:['https://v3-dy-o.zjcdn.com/test.mp4']}]};
  const f = render(new Map(),{ok:true,tabId:10,work});
  f.elements.get('link').value = url;
  await f.elements.get('start').click();
  assert.equal(f.messages.length,1); assert.equal(f.messages[0].action,'resolve-douyin'); assert.equal(f.messages[0].url,url);
  assert.equal(f.elements.get('status').dataset.state,'complete');
  assert.equal(f.elements.get('showPage').hidden,true); assert.deepEqual(f.focus,[]);
});
test('a login failure offers retry for the same operation without focusing an unrelated tab', async () => {
  const f = render(new Map(),{ok:false,code:'LOGIN_REQUIRED',tabId:10,error:'请完成登录后重试'});
  f.elements.get('link').value = url;
  await f.elements.get('start').click();
  assert.equal(f.elements.get('showPage').hidden,false); assert.equal(f.elements.get('retry').hidden,false);
  f.elements.get('link').value = `https://www.douyin.com/video/1111111111111111111`;
  await f.elements.get('retry').click();
  assert.equal(f.messages[1].retry,true); assert.equal(f.messages[1].url,url); assert.deepEqual(f.focus,[]);
});

const completedJob = {
  id:'a'.repeat(32),workId:id,title:'测试 fixture · 当前稿',status:'complete',
  text:'第一句。\n第二句。',srt:'original SRT is not the edited export',
  durationSeconds:5,characters:9,segments:2,elapsedSeconds:1.25,hasAudio:true,
  reviewSegments:[{id:0,startMs:100,endMs:1500,text:'第一句。'}, {id:1,startMs:2000,endMs:4000,text:'第二句。'}]
};
function cachedDraft(job = completedJob, text = '保留我的修改。\n第二句。') {
  const current = draft.editFullText(draft.createDraft(job,review.createReview(job)),text);
  return new Map([
    ['lastCompleted-v1',JSON.stringify({id:job.id,workId:job.workId})],
    ['lastTranscription',JSON.stringify({id:job.id,workId:job.workId})],
    ['result-v1-' + job.id,JSON.stringify(job)],
    ['draft-v1-' + job.id,JSON.stringify(draft.saveableDraft(current))]
  ]);
}

test('layout migration retains unique legacy DOM IDs and all existing event entry points', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size,ids.length,'duplicate IDs silently bind events to the wrong control');
  const f = render();
  const bindings = {
    start:'click',transcribe:'click',current:'click',refresh:'click',showPage:'click',resume:'click',retry:'click',
    dismissLoginTip:'click',loginDouyin:'click',exportTxt:'click',exportSrt:'click',copy:'click',importTerms:'click',
    enableTerms:'change',link:'input',tabs:'change',checkConnection:'click',transcriptText:'input',segmentText:'input',
    confirmSegment:'change',reviewDetails:'toggle',segmentSelect:'change',previousSegment:'click',nextSegment:'click',
    playSegment:'click',reviewAudio:'timeupdate',nextAttention:'click'
  };
  for (const [name,event] of Object.entries(bindings)) assert.ok(f.elements.get(name)?.handlers.has(event),name + ' is no longer wired');
  assert.ok(f.elements.get('transcriptText').handlers.has('beforeinput'));
  assert.equal(f.elements.get('appVersion').textContent,'v0.1.5');
});

test('empty navigation opens existing settings and help without creating tasks or pretending to have history', async () => {
  let serviceCalls = 0;
  const f = render(new Map(),undefined,{ensureLocalService:async() => {serviceCalls++;}});
  assert.equal(f.elements.get('transcriptSection').hidden,true);
  assert.equal(f.elements.get('emptyTranscript').hidden,false);
  for (const name of ['openSettings','openServiceHelp','recentDraft']) await f.elements.get(name).click();
  assert.equal(f.elements.get('settingsPanel').open,true);
  assert.equal(f.elements.get('serviceHelp').hidden,false);
  assert.equal(f.elements.get('serviceHelp').open,true);
  assert.match(f.elements.get('recentState').textContent,/还没有可恢复/);
  assert.equal(f.elements.get('resume').hidden,true);
  assert.equal(serviceCalls,0); assert.deepEqual(f.messages,[]); assert.deepEqual(f.downloads,[]);
});

test('opening with a cached completed result restores the edited draft without connecting the service', async () => {
  let serviceCalls = 0;
  const f = render(cachedDraft(),undefined,{ensureLocalService:async() => { serviceCalls++; throw new Error('offline fixture'); }});
  assert.equal(f.elements.get('transcriptSection').hidden,false);
  assert.equal(f.elements.get('emptyTranscript').hidden,true);
  assert.equal(f.elements.get('transcriptText').value,'保留我的修改。\n第二句。');
  assert.match(f.elements.get('status').textContent,/已恢复本机当前稿/);
  assert.equal(f.elements.get('reviewPanel').hidden,false);
  assert.match(f.elements.get('saveState').textContent,/已保存在本机/);
  await f.elements.get('recentDraft').click();
  assert.equal(f.focus.at(-1),'transcriptText');
  assert.equal(serviceCalls,0); assert.deepEqual(f.messages,[]);
});

test('source selector rejects the extension itself and passes only the chosen supported work to the worker', async () => {
  const work = {id,title:'fixture work',durationMs:1000,variants:[{width:1280,height:720,size:123,format:'mp4',isH265:0,urls:['https://v3-dy-o.zjcdn.com/test.mp4']}]};
  const f = render(new Map(),{ok:true,tabId:42,work},{},{tabs:[
    {id:1,url:'chrome-extension://abcdefghijklmnopabcdefghijklmnop/tool.html',title:'ClipQuill'},
    {id:2,url:'https://www.douyin.com/',title:'抖音首页'},
    {id:3,url:'https://example.com/video/' + id,title:'unsupported'},
    {id:42,url,title:'正确作品'}
  ]});
  await f.elements.get('refresh').click();
  assert.deepEqual(JSON.parse(JSON.stringify(f.queries.at(-1))),{url:'https://www.douyin.com/*'});
  assert.deepEqual(f.elements.get('tabs').options.map(option=>option.value),['42']);
  f.elements.get('tabs').value = '42'; f.elements.get('existingAction').value = 'download';
  await f.elements.get('current').click();
  assert.equal(f.messages.length,1);
  assert.equal(f.messages[0].action,'resolve-douyin'); assert.equal(f.messages[0].existingTabId,42);
  assert.equal(f.messages[0].url,null);
  assert.equal(f.downloads[0].filename,`抖音独立导出/${id}_720p_fixture work.mp4`);
  assert.equal(f.downloads[0].conflictAction,'uniquify');
});

test('current edits save to the existing draft key and feed clipboard, TXT and SRT through the relocated controls', async () => {
  const f = render(cachedDraft());
  const field = f.elements.get('transcriptText');
  const next = '新的中文🙂。\n第二句。';
  field.selectionStart = 0; field.selectionEnd = field.value.indexOf('\n');
  await field.emit('beforeinput',{inputType:'insertText'});
  field.value = next;
  await field.emit('input');
  assert.match(f.elements.get('saveState').textContent,/已保存在本机/);
  assert.ok(f.writes.includes('draft-v1-' + completedJob.id));
  assert.equal(JSON.parse(f.saved.get('draft-v1-' + completedJob.id)).blocks[0].text,'新的中文🙂。');
  await f.elements.get('copy').click();
  await f.elements.get('exportTxt').click();
  await f.elements.get('exportSrt').click();
  assert.deepEqual(f.copied,[next]);
  assert.equal(await f.exports[0].blob.text(),next);
  const srt = await f.exports[1].blob.text();
  assert.match(srt,/00:00:00,100 --> 00:00:01,500\n新的中文🙂。/);
  assert.match(srt,/00:00:02,000 --> 00:00:04,000\n第二句。/);
  assert.equal(f.exports[0].filename,id + '_文案_当前稿.txt');
  assert.equal(f.exports[1].filename,id + '_文案_当前稿.srt');
  assert.match(f.elements.get('copyState').textContent,/已发起 SRT 导出/);
  assert.deepEqual(f.messages,[]);
});

test('failed current-draft writes are explained while the current text stays available for copy and export', async () => {
  const f = render(cachedDraft());
  const draftKey = 'draft-v1-' + completedJob.id;
  const previous = f.saved.get(draftKey);
  f.failWrites.add(draftKey);
  const field = f.elements.get('transcriptText');
  field.value = '本次未保存。\n第二句。';
  await field.emit('input');
  assert.equal(field.value,'本次未保存。\n第二句。');
  assert.match(f.elements.get('saveState').textContent,/保存失败/);
  assert.match(f.elements.get('copyState').textContent,/自动保存失败/);
  assert.equal(f.saved.get(draftKey),previous);
  await f.elements.get('copy').click(); await f.elements.get('exportTxt').click();
  assert.equal(f.copied[0],field.value); assert.equal(await f.exports[0].blob.text(),field.value);
});

test('cached-result storage failure never reports a saved draft or blocks its offline text', () => {
  const f = render(cachedDraft(),undefined,{}, {failWrites:['result-v1-' + completedJob.id]});
  assert.equal(f.elements.get('transcriptText').value,'保留我的修改。\n第二句。');
  assert.equal(f.elements.get('transcriptSection').hidden,false);
  assert.match(f.elements.get('saveState').textContent,/保存失败/);
  assert.match(f.elements.get('copyState').textContent,/自动保存失败/);
});

test('corrupt current-draft JSON is retained with a readable fallback warning and recovery copy', () => {
  const saved = cachedDraft(), key = 'draft-v1-' + completedJob.id, raw = '{broken current draft';
  saved.set(key,raw);
  const f = render(saved);
  assert.equal(f.elements.get('transcriptText').value,completedJob.text);
  assert.match(f.elements.get('copyState').textContent,/无法读取/);
  assert.equal(saved.get(key),raw,'opening the page must not overwrite a corrupt original');
  assert.equal(JSON.parse(saved.get('draft-rejected-v1-'+completedJob.id)),raw);
});
