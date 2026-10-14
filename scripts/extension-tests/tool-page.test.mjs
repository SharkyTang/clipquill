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
import * as metadata from '../../outputs/douyin-independent-extension/metadata.mjs';
import * as progress from '../../outputs/douyin-independent-extension/progress.mjs';

const directory = new URL('../../outputs/douyin-independent-extension/', import.meta.url);
const html = readFileSync(new URL('tool.html',directory),'utf8');
const source = readFileSync(new URL('tool.js',directory),'utf8').replace(/^import .*;\n/gm,'');
const id = '7689864994510343451', url = `https://www.douyin.com/video/${id}`;
function render(saved = new Map(), response = {ok:true,tabId:10}, overrides = {}, fixture = {}) {
  const elements = new Map(), messages = [], focus = [], queries = [], downloads = [], copied = [], exports = [], writes = [];
  const objectURLs = new Map(), failWrites = new Set(fixture.failWrites || []);
  for (const match of html.matchAll(/\bid="([^"]+)"[^>]*>/g)) {
    const handlers = new Map();
    const attributes = new Map([...match[0].matchAll(/\b([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1],attribute[2]]));
    elements.set(match[1], {hidden: /\bhidden\b/.test(match[0]), disabled: false, checked: false, open: false,
      value: '', textContent: '', dataset: {}, options: [], handlers, attributes, selectionStart: 0, selectionEnd: 0,
      setAttribute(name,value) { attributes.set(name,String(value)); }, getAttribute(name) { return attributes.get(name) ?? null; },
      addEventListener(name, listener) { handlers.set(name, [...handlers.get(name) || [], listener]); },
      async emit(name, event = {}) { for (const listener of handlers.get(name) || []) await listener(event); },
      async click() { if (!this.disabled) return this.emit('click'); },
      replaceChildren(...children) { this.options = children; this.value = children[0]?.value || ''; },
      append(child) { this.options.push(child); if (this.options.length === 1) this.value = child.value; },
      focus() { focus.push(match[1]); }, select() { this.selectionStart = 0; this.selectionEnd = this.value.length; },
      scrollIntoView() {}, pause() {}, load() {}, removeAttribute(name) { attributes.delete(name); delete this[name]; }
    });
  }
  elements.get('quality').value = '720';
  elements.get('existingAction').value = 'transcribe';
  const images = [];
  const document = {getElementById: name => elements.get(name), createElement: tag => {
    if (tag === 'a') return {click() { exports.push({filename:this.download, blob:objectURLs.get(this.href)}); }};
    const node = {dataset:{},children:[],append(...children) { this.children.push(...children); }};
    if (tag === 'img') images.push(node);
    return node;
  }};
  const localStorage = {getItem: key => saved.get(key) ?? null, setItem(key,value) {
    if (failWrites.has(key)) throw new Error('fixture storage full');
    writes.push(key); saved.set(key,value);
  }, removeItem: key => saved.delete(key)};
  const chrome = {
    runtime: {getManifest() { return {version:'0.1.5'}; }, async sendMessage(value) { messages.push(value); return typeof response === 'function' ? response(value) : response; }},
    tabs: {async query(value) { queries.push(value); return fixture.tabs || []; }, async create() { throw new Error('tool must not create parser tabs directly'); }, async update(tabId,value) { focus.push({tabId,...value}); return {windowId:2}; }},
    windows: {async update() {}},
    downloads: {onChanged: {addListener() {}}, async download(value) { downloads.push(value); return 1; }, async search() {
      return fixture.downloadSearch ? fixture.downloadSearch() : [{state:'complete',fileSize:123,filename:'/downloads/a.mp4'}];
    }}
  };
  class FixtureURL extends URL {
    static createObjectURL(blob) { const value = 'blob:fixture-' + objectURLs.size; objectURLs.set(value,blob); return value; }
    static revokeObjectURL(value) { objectURLs.delete(value); }
  }
  const navigator = {clipboard:{async writeText(text) {
    if (fixture.clipboardWrite) return fixture.clipboardWrite(text);
    if (fixture.clipboardError) throw new Error('fixture clipboard unavailable');
    copied.push(text);
  }}};
  const timers = (...args) => { const timer = setTimeout(...args); timer.unref?.(); return timer; };
  vm.runInNewContext(source,{...core,...transcription,...video,...review,...draft,...settings,...service,...editor,...metadata,...progress,...overrides,
    document,localStorage,chrome,navigator,Blob,URL:FixtureURL,setTimeout:timers,clearTimeout,console}, {filename:'tool.js'});
  return {elements,messages,focus,saved,queries,downloads,copied,exports,writes,failWrites,images};
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
    start:'click',transcribe:'click',current:'click',refresh:'click',showPage:'click',resume:'click',retry:'click',expandSource:'click',
    dismissLoginTip:'click',loginDouyin:'click',exportTxt:'click',exportSrt:'click',copy:'click',importTerms:'click',
    enableTerms:'change',link:'input',tabs:'change',checkConnection:'click',transcriptText:'input',segmentText:'input',
    confirmSegment:'change',retrySave:'click',reviewDetails:'toggle',segmentSelect:'change',previousSegment:'click',nextSegment:'click',
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

test('expanding and collapsing a complete share text preserves source and current draft without creating work', async () => {
  let serviceCalls = 0;
  const f = render(cachedDraft(),undefined,{ensureLocalService:async() => { serviceCalls += 1; }});
  const link = f.elements.get('link'), field = f.elements.get('transcriptText'), toggle = f.elements.get('expandSource');
  const shareText = '6.58 复制打开抖音，看看作者的作品！\n' + '完整分享说明，包含空格与中文。 '.repeat(30) + '\n' + url + ' 复制这段文字打开';
  const draftText = field.value, previousWrites = [...f.writes];
  link.value = shareText; link.selectionStart = 8; link.selectionEnd = 12;
  field.selectionStart = 2; field.selectionEnd = 6;
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
  await toggle.click();
  assert.equal(f.elements.get('sourceInput').dataset.expanded,'true');
  assert.equal(toggle.getAttribute('aria-expanded'),'true');
  assert.equal(toggle.textContent,'收起输入');
  await toggle.click();
  assert.equal(f.elements.get('sourceInput').dataset.expanded,'false');
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
  assert.equal(toggle.textContent,'展开输入');
  assert.equal(link.value,shareText);
  assert.equal(link.selectionStart,8); assert.equal(link.selectionEnd,12);
  assert.equal(field.value,draftText);
  assert.equal(field.selectionStart,2); assert.equal(field.selectionEnd,6);
  assert.deepEqual(f.writes,previousWrites);
  assert.equal(serviceCalls,0);
  assert.deepEqual(f.messages,[]); assert.deepEqual(f.downloads,[]);
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

for (const initiallyUnsaved of [false,true]) {
  test(`cancelled IME composition restores the actual ${initiallyUnsaved ? 'failed' : 'saved'} draft state`, async () => {
    const f = render(cachedDraft());
    const field = f.elements.get('transcriptText');
    const draftKey = 'draft-v1-' + completedJob.id;
    if (initiallyUnsaved) {
      f.failWrites.add(draftKey);
      field.value = '当前修改保存失败。\n第二句。';
      await field.emit('input',{inputType:'insertText'});
      assert.match(f.elements.get('saveState').textContent,/保存失败/);
    }
    const original = field.value, persisted = f.saved.get(draftKey);
    await field.emit('compositionstart');
    field.value = original + '临时拼音';
    await field.emit('input',{isComposing:true});
    assert.match(f.elements.get('saveState').textContent,/输入中/);
    field.value = original;
    await field.emit('compositionend');
    assert.equal(field.value,original);
    assert.equal(f.saved.get(draftKey),persisted,'cancelled composition must not save intermediate text');
    assert.match(f.elements.get('saveState').textContent,initiallyUnsaved ? /保存失败/ : /已保存在本机/);
  });
}

test('confirming a review segment cannot replace text that failed subtitle mapping or claim it was saved', async () => {
  const f = render(cachedDraft(),undefined,{
    createDraftEditor(initial) {
      const current = editor.createDraftEditor(initial), input = current.input;
      current.input = (target,...args) => {
        if (target === 'full') throw new Error('隔离测试：字幕映射暂不可用');
        return input(target,...args);
      };
      return current;
    }
  });
  const field = f.elements.get('transcriptText'), key = 'draft-v1-' + completedJob.id;
  const persisted = f.saved.get(key), raw = '不能被旧稿替换的当前输入。\n第二句。';
  field.value = raw;
  await field.emit('input',{inputType:'insertText'});
  assert.match(f.elements.get('saveState').textContent,/尚未保存/);
  f.elements.get('confirmSegment').checked = true;
  await f.elements.get('confirmSegment').emit('change');
  assert.equal(field.value,raw,'review confirmation must not redraw the stale mapped draft over the visible input');
  assert.equal(f.saved.get(key),persisted,'an unmapped visible edit is not a successfully saved current draft');
  assert.doesNotMatch(f.elements.get('saveState').textContent,/已保存在本机/);
  await f.elements.get('copy').click();
  await f.elements.get('exportTxt').click();
  assert.equal(f.copied.at(-1),raw);
  assert.equal(await f.exports.at(-1).blob.text(),raw);
});

test('a delayed clipboard rejection cannot select all or interrupt a newer IME composition', async () => {
  const clipboard = deferred();
  const f = render(cachedDraft(),undefined,{}, {clipboardWrite:() => clipboard.promise});
  const field = f.elements.get('transcriptText');
  const copying = f.elements.get('copy').click();
  field.selectionStart = 0; field.selectionEnd = 2;
  await field.emit('compositionstart');
  field.value = '正在输入的新文案。\n第二句。';
  field.selectionStart = 3; field.selectionEnd = 3;
  await field.emit('input',{isComposing:true});
  clipboard.reject(new Error('隔离测试：剪贴板权限稍后被拒绝'));
  await copying;
  assert.equal(field.selectionStart,3,'a failed previous copy must not change the current IME selection');
  assert.equal(field.selectionEnd,3);
  assert.equal(field.value,'正在输入的新文案。\n第二句。');
  assert.equal(f.focus.includes('transcriptText'),false,'do not steal focus back into the editor after asynchronous failure');
  assert.match(f.elements.get('copyState').textContent,/复制|剪贴板|快捷键/);
  await field.emit('compositionend');
});

for (const failureKind of ['draft','result-cache']) {
  test(`manual save retry recovers a ${failureKind} write failure without another edit or lost selection`, async () => {
    const draftKey = 'draft-v1-' + completedJob.id, cacheKey = 'result-v1-' + completedJob.id;
    const failingKey = failureKind === 'draft' ? draftKey : cacheKey;
    const f = render(cachedDraft(),undefined,{}, {failWrites:failureKind === 'result-cache' ? [failingKey] : []});
    const field = f.elements.get('transcriptText');
    if (failureKind === 'draft') {
      f.failWrites.add(failingKey);
      field.value = '等待手动重试保存的当前稿。\n第二句。';
      await field.emit('input',{inputType:'insertText'});
    }
    assert.match(f.elements.get('saveState').textContent,/保存失败/);
    assert.equal(f.elements.get('saveState').dataset.state,'error');
    assert.equal(f.elements.get('retrySave').hidden,false);
    const expected = field.value;
    field.selectionStart = 2; field.selectionEnd = 5;
    f.failWrites.delete(failingKey);
    await f.elements.get('retrySave').click();
    assert.equal(field.value,expected);
    assert.equal(field.selectionStart,2);
    assert.equal(field.selectionEnd,5);
    assert.equal(JSON.parse(f.saved.get(draftKey)).blocks.map(block => block.text).join('\n'),expected);
    assert.equal(JSON.parse(f.saved.get(cacheKey)).id,completedJob.id);
    assert.equal(JSON.parse(f.saved.get('lastCompleted-v1')).id,completedJob.id);
    assert.equal(f.elements.get('saveState').dataset.state,'saved');
    assert.equal(f.elements.get('retrySave').hidden,true);
    assert.deepEqual(f.messages,[]);
  });
}

test('a queued manual save retry cannot save intermediate IME text', async () => {
  const f = render(cachedDraft());
  const field = f.elements.get('transcriptText'), draftKey = 'draft-v1-' + completedJob.id;
  f.failWrites.add(draftKey);
  field.value = '第一次保存失败的修改。\n第二句。';
  await field.emit('input',{inputType:'insertText'});
  assert.equal(f.elements.get('retrySave').hidden,false);
  const persisted = f.saved.get(draftKey);
  await field.emit('compositionstart');
  field.value = '还在输入法中。\n第二句。';
  await field.emit('input',{isComposing:true});
  f.failWrites.delete(draftKey);
  await f.elements.get('retrySave').click();
  assert.equal(field.value,'还在输入法中。\n第二句。');
  assert.equal(f.saved.get(draftKey),persisted);
  assert.equal(f.elements.get('saveState').dataset.state,'pending');
  await field.emit('compositionend');
  assert.equal(JSON.parse(f.saved.get(draftKey)).blocks.map(block => block.text).join('\n'),field.value);
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

const coverA = 'https://p3-pc-sign.douyinpic.com/current-cover-a.jpg';
const coverB = 'https://p9-pc-sign.douyinpic.com/current-cover-b.jpg';
const avatarA = 'https://p3-pc.douyinpic.com/current-avatar-a.jpg';
const avatarB = 'https://p3-pc.douyinpic.com/current-avatar-b.jpg';
function cardWork(workId = id, extra = {}) {
  return {id:workId,pageURL:`https://www.douyin.com/video/${workId}`,title:'当前作品 ' + workId,durationMs:5000,
    coverURLs:[coverA],avatarURLs:[avatarA],authorName:'当前作者',
    variants:[{width:1280,height:720,size:123,format:'mp4',isH265:0,urls:['https://v3-dy-o.zjcdn.com/current.mp4']}],...extra};
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((done,failed) => { resolve = done; reject = failed; });
  return {promise,resolve,reject};
}

test('card size remains page-advertised until Chrome confirms actual file bytes', async () => {
  const queried = deferred(), complete = deferred();
  const f = render(new Map(),{ok:true,work:cardWork()},{},{downloadSearch:() => {
    queried.resolve(); return complete.promise;
  }});
  f.elements.get('link').value = url;
  const task = f.elements.get('start').click();
  await queried.promise;
  assert.equal(f.elements.get('sizeValue').textContent,'123 B');
  assert.match(f.elements.get('sizeSource').textContent,/大小：页面标称/);
  assert.match(f.elements.get('sizeSource').textContent,/时长与分辨率：页面元数据/);
  assert.equal(f.elements.get('durationValue').textContent,'00:05');
  assert.equal(f.elements.get('resolutionValue').textContent,'1280 × 720');
  complete.resolve([{state:'complete',fileSize:123,filename:'/downloads/verified.mp4'}]);
  await task;
  assert.match(f.elements.get('sizeSource').textContent,/大小：本地文件已核对/);
  assert.equal(f.elements.get('status').dataset.state,'complete');
});

test('a mismatched completed download never earns a verified size or completion claim', async () => {
  const f = render(new Map(),{ok:true,work:cardWork()},{},{downloadSearch:async() => [{state:'complete',fileSize:122,filename:'/downloads/incomplete.mp4'}]});
  f.elements.get('link').value = url;
  await f.elements.get('start').click();
  assert.match(f.elements.get('sizeSource').textContent,/大小：页面标称/);
  assert.equal(f.elements.get('status').dataset.state,'error');
  assert.match(f.elements.get('status').textContent,/下载文件大小不一致/);
});

test('a validated reused candidate updates actual selected size without downloading or claiming recognition success', async () => {
  const work = cardWork(id,{variants:[...cardWork().variants,{width:1920,height:1080,size:456,format:'mp4',isH265:0,urls:['https://v3-dy-o.zjcdn.com/reused.mp4']}]});
  const requests = [];
  const f = render(new Map(),{ok:true,work},{
    ensureLocalService:async() => {},
    localRequest:async(path,payload) => {
      requests.push({path,payload});
      if (path === '/videos/find') return {file:{workId:id,durationMs:work.durationMs,height:1080,expectedBytes:456,path:'/downloads/reused.mp4'}};
      throw new Error('隔离测试：复用完成后识别服务返回错误');
    }
  });
  f.elements.get('link').value = url;
  await f.elements.get('transcribe').click();
  assert.deepEqual(requests.map(item => item.path),['/videos/find','/jobs']);
  assert.deepEqual(f.downloads,[]);
  assert.equal(f.elements.get('resolutionValue').textContent,'1920 × 1080');
  assert.equal(f.elements.get('sizeValue').textContent,'456 B');
  assert.match(f.elements.get('sizeSource').textContent,/大小：本地文件已核对/);
  assert.match(f.elements.get('downloadState').textContent,/已下载的完整视频/);
  assert.equal(f.elements.get('status').dataset.state,'error');
  assert.match(f.elements.get('status').textContent,/隔离测试/);
});

test('late detached cover and avatar events cannot overwrite a newly selected source', async () => {
  const nextId = '1111111111111111111', nextURL = `https://www.douyin.com/video/${nextId}`;
  const originalDraft = '保留我的修改。\n第二句。';
  const f = render(cachedDraft(),message => ({ok:true,work:message.url === url ? cardWork() : cardWork(nextId,{coverURLs:[coverB],avatarURLs:[avatarB],authorName:'第二位作者'})}));
  f.elements.get('link').value = url;
  await f.elements.get('start').click();
  const [oldCover,oldAvatar] = f.images;
  assert.equal(oldCover.src,coverA);
  assert.equal(oldAvatar.src,avatarA);
  assert.equal(oldCover.referrerPolicy,'no-referrer');
  f.elements.get('link').value = nextURL;
  await f.elements.get('link').emit('input');
  oldCover.onload(); oldAvatar.onload(); oldCover.onerror();
  assert.equal(f.elements.get('result').hidden,true);
  assert.equal(f.elements.get('coverImage').hidden,true);
  assert.equal(f.elements.get('coverImage').src,undefined);
  assert.equal(f.elements.get('authorAvatar').hidden,true);
  await f.elements.get('start').click();
  const [nextCover,nextAvatar] = f.images.slice(2);
  nextCover.onload(); nextAvatar.onload();
  oldCover.onload(); oldAvatar.onload(); oldCover.onerror();
  assert.equal(f.elements.get('coverImage').src,coverB);
  assert.equal(f.elements.get('authorAvatar').src,avatarB);
  assert.equal(f.elements.get('authorName').textContent,'第二位作者');
  assert.equal(f.elements.get('videoCover').dataset.state,'ready');
  assert.equal(f.elements.get('coverState').hidden,true);
  assert.match(f.elements.get('title').textContent,new RegExp(nextId));
  assert.equal(f.elements.get('transcriptText').value,originalDraft);
});

test('failed source cover keeps a readable placeholder and the remaining true metadata', async () => {
  const f = render(new Map(),{ok:true,work:cardWork()});
  f.elements.get('link').value = url;
  await f.elements.get('start').click();
  f.images[0].onerror();
  assert.equal(f.elements.get('videoCover').dataset.state,'error');
  assert.equal(f.elements.get('coverImage').hidden,true);
  assert.equal(f.elements.get('coverImage').src,undefined);
  assert.equal(f.elements.get('coverState').hidden,false);
  assert.equal(f.elements.get('coverState').textContent,'封面暂不可用');
  assert.equal(f.elements.get('videoPlatform').textContent,'抖音');
  assert.equal(f.elements.get('resolutionValue').textContent,'1280 × 720');
  assert.equal(f.elements.get('videoAuthor').hidden,false);
});

test('a visible image failure after successful preload restores the placeholder and stays source-bound', async () => {
  const nextId = '1111111111111111111', nextURL = `https://www.douyin.com/video/${nextId}`;
  const f = render(new Map(),message => ({ok:true,work:message.url === url ? cardWork() : cardWork(nextId,{coverURLs:[coverB]})}));
  f.elements.get('link').value = url;
  await f.elements.get('start').click();
  f.images[0].onload();
  const display = f.elements.get('coverImage'), oldVisibleError = display.onerror;
  assert.equal(display.hidden,false);
  assert.equal(f.elements.get('coverState').hidden,true);
  assert.equal(typeof oldVisibleError,'function');
  oldVisibleError();
  assert.equal(display.hidden,true);
  assert.equal(f.elements.get('videoCover').dataset.state,'error');
  assert.equal(f.elements.get('coverState').hidden,false);
  assert.equal(f.elements.get('coverState').textContent,'封面暂不可用');
  assert.equal(f.elements.get('resolutionValue').textContent,'1280 × 720');
  f.elements.get('link').value = nextURL;
  await f.elements.get('link').emit('input');
  await f.elements.get('start').click();
  f.images[2].onload();
  oldVisibleError();
  assert.equal(display.src,coverB);
  assert.equal(display.hidden,false);
  assert.equal(f.elements.get('videoCover').dataset.state,'ready');
  assert.equal(f.elements.get('coverState').hidden,true);
});

test('resuming the same work preserves a pending cover request across operation IDs', async () => {
  const saved = new Map([['lastTranscription',JSON.stringify({id:completedJob.id,workId:id})]]);
  let queries = 0;
  const f = render(saved,{ok:true,work:cardWork()},{
    ensureLocalService:async() => {},
    localRequest:async path => {
      assert.equal(path,'/jobs/' + completedJob.id);
      queries += 1;
      return completedJob;
    }
  });
  f.elements.get('link').value = url;
  await f.elements.get('start').click();
  const [coverRequest,avatarRequest] = f.images;
  assert.equal(f.elements.get('coverImage').hidden,true);
  await f.elements.get('resume').click();
  assert.equal(queries,1);
  assert.equal(f.images.length,2,'same-work resume should retain the in-flight image requests');
  coverRequest.onload(); avatarRequest.onload();
  assert.equal(f.elements.get('coverImage').src,coverA);
  assert.equal(f.elements.get('coverImage').hidden,false);
  assert.equal(f.elements.get('authorAvatar').src,avatarA);
  assert.equal(f.elements.get('videoCover').dataset.state,'ready');
  assert.equal(f.elements.get('coverState').hidden,true);
  assert.equal(f.elements.get('transcriptText').value,completedJob.text);
});

test('untrusted image URLs create no image requests and no pretend preview control', async () => {
  const work = cardWork(id,{coverURLs:['javascript:alert(1)','https://untrusted.test/cover.jpg'],avatarURLs:['data:image/png;base64,abc'],authorName:'<img src=x onerror=alert(1)>'});
  const f = render(new Map(),{ok:true,work});
  f.elements.get('link').value = url;
  await f.elements.get('start').click();
  assert.equal(f.images.length,0);
  assert.equal(f.elements.get('coverImage').hidden,true);
  assert.equal(f.elements.get('coverState').textContent,'暂无可用封面');
  assert.equal(f.elements.get('authorAvatar').hidden,true);
  assert.equal(f.elements.get('authorName').textContent,work.authorName);
  const coverMarkup = html.match(/<div id="videoCover"[\s\S]*?<\/div>/)?.[0];
  assert.ok(coverMarkup);
  assert.doesNotMatch(coverMarkup,/<(?:button|a|video)\b|role=["']button["']|▶/);
  assert.match(f.elements.get('facts').textContent,/预览尚无已验证/);
});
