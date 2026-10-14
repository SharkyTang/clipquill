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

const directory = new URL('../../outputs/douyin-independent-extension/', import.meta.url);
const html = readFileSync(new URL('tool.html',directory),'utf8');
const source = readFileSync(new URL('tool.js',directory),'utf8').replace(/^import .*;\n/gm,'');
const id = '7689864994510343451', url = `https://www.douyin.com/video/${id}`;
function render(saved = new Map(), response = {ok:true,tabId:10}, overrides = {}) {
  const elements = new Map(), messages = [], focus = [];
  for (const match of html.matchAll(/\bid="([^"]+)"[^>]*>/g)) {
    const handlers = new Map();
    elements.set(match[1], {hidden: /\bhidden\b/.test(match[0]), disabled: false, checked: false, value: '', textContent: '', dataset: {}, options: [],
      addEventListener(name, listener) { handlers.set(name, listener); },
      async click() { if (!this.disabled) return handlers.get('click')?.(); },
      replaceChildren(...children) { this.options = children; }, append(child) { this.options.push(child); }
    });
  }
  elements.get('quality').value = '720';
  const document = {getElementById: name => elements.get(name), createElement: () => ({})};
  const localStorage = {getItem: key => saved.get(key) ?? null, setItem: (key,value) => saved.set(key,value), removeItem: key => saved.delete(key)};
  const chrome = {
    runtime: {async sendMessage(value) { messages.push(value); return typeof response === 'function' ? response(value) : response; }},
    tabs: {async query() { return []; }, async create() { throw new Error('tool must not create parser tabs directly'); }, async update(tabId,value) { focus.push({tabId,...value}); return {windowId:2}; }},
    windows: {async update() {}},
    downloads: {onChanged: {addListener() {}}, async download() { return 1; }, async search() { return [{state:'complete',fileSize:123,filename:'/downloads/a.mp4'}]; }}
  };
  vm.runInNewContext(source,{...core,...transcription,...video,...review,...draft,...settings,...service,...overrides, document,localStorage,chrome,URL,setTimeout,clearTimeout,console}, {filename:'tool.js'});
  return {elements,messages,focus,saved};
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
  const work = {id,title:'test',durationMs:1000,variants:[]};
  let attempts = 0;
  const f = render(new Map(),message => { events.push('parse'); return {ok:true,tabId:10,work}; },{
    async ensureLocalService() {
      events.push('ensure');
      if (++attempts === 1) throw Object.assign(new Error('本地助手启动失败'),{serviceStartup:true});
    },
    async startVideoTranscription() { events.push('transcribe'); throw new Error('stop fixture after job submission'); }
  });
  f.elements.get('link').value = url;
  await f.elements.get('transcribe').click();
  assert.equal(f.elements.get('retry').hidden,false);
  assert.equal(f.elements.get('retry').textContent,'重试启动并提取');
  assert.deepEqual(events,['ensure']);
  f.elements.get('link').value = 'https://www.douyin.com/video/1111111111111111111';
  await f.elements.get('retry').click();
  assert.deepEqual(events,['ensure','ensure','parse','transcribe']);
  assert.equal(f.messages[0].url,url);
  assert.equal(f.elements.get('retry').textContent,'重试本次操作');
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
