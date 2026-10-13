import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

test('worker messages wire real page capture, reuse, auth focus and retry without account data', async () => {
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const id = '7689864994510343451', url = `https://www.douyin.com/video/${id}`;
  const pages = new Map(), stored = {}, updates = [], focused = [], listeners = [];
  let mode = 'ready', creates = 0;
  globalThis.chrome = {
    runtime: {id: extensionId, getURL: path => `chrome-extension://${extensionId}/${path}`, onMessage: {addListener: fn => listeners.push(fn)}},
    action: {onClicked: {addListener() {}}},
    storage: {session: {
      async get(key) { return {[key]: structuredClone(stored[key])}; },
      async set(values) { Object.assign(stored,structuredClone(values)); },
      async remove(key) { delete stored[key]; }
    }},
    windows: {async update(windowId, value) { focused.push({windowId,...value}); }},
    tabs: {
      async create(options) { creates++; const tab = {id:10,windowId:2,status:'complete',...options}; pages.set(tab.id,tab); return {...tab}; },
      async get(tabId) { return {...pages.get(tabId)}; },
      async update(tabId, value) { updates.push({tabId,...value}); Object.assign(pages.get(tabId),value); return {...pages.get(tabId)}; }
    },
    scripting: {async executeScript({target,func}) {
      const node = text => ({textContent:text,closest:()=>null,getBoundingClientRect:()=>({width:100,height:100})});
      const data = {app:{privateSession:'PRIVATE',videoDetail: mode === 'login' ? undefined : {awemeId:id,desc:'fixture',video:{duration:1000,bitRateList:[]}}}};
      const document = {querySelectorAll(selector) {
        if (selector.startsWith('script#')) return [{textContent: mode === 'bad-data' ? 'bad json' : JSON.stringify(data)}];
        if (selector.includes('role="dialog"')) return mode === 'login' ? [node('扫码登录 PRIVATE')] : [];
        if (selector.includes('captcha')) return mode === 'verification' ? [node('PRIVATE challenge')] : [];
        return [];
      }};
      return [{result: vm.runInNewContext(`(${func.toString()})()`,{document,location:new URL(pages.get(target.tabId).url),URL,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})})}];
    }}
  };
  try {
    await import('../../outputs/douyin-independent-extension/background.js');
    const sender = {id:extensionId,url:chrome.runtime.getURL('tool.html'),tab:{windowId:2}};
    const handler = listeners[0];
    assert.equal(handler({action:'resolve-douyin',url},{...sender,id:'another-extension'},()=>{}),false);
    assert.equal(creates,0);
    const message = payload => new Promise(resolve => { assert.equal(handler(payload,sender,resolve),true); });
    const first = await message({action:'resolve-douyin',url});
    const next = await message({action:'resolve-douyin',url});
    assert.equal(first.ok,true); assert.equal(first.work.id,id); assert.equal(next.tabId,first.tabId); assert.equal(creates,1);
    assert.deepEqual(focused,[]); assert.ok(updates.every(change => change.active !== true));
    for (const type of ['login','verification']) {
      mode = type;
      const blocked = await message({action:'resolve-douyin',url});
      assert.equal(blocked.ok,false); assert.equal(blocked.code,type === 'login' ? 'LOGIN_REQUIRED' : 'VERIFICATION_REQUIRED'); assert.equal(blocked.tabId,10);
      assert.equal(focused.at(-1).focused,true);
      const changed = updates.length;
      mode = 'ready';
      const retry = await message({action:'resolve-douyin',url,retry:true});
      assert.equal(retry.ok,true); assert.equal(updates.length,changed); assert.equal(creates,1);
      assert.ok(!JSON.stringify(retry).includes('PRIVATE'));
    }
    mode = 'bad-data';
    const count = focused.length;
    const failed = await message({action:'resolve-douyin',url});
    assert.equal(failed.ok,false); assert.equal(focused.length,count); assert.match(failed.error,/格式/);
  } finally { delete globalThis.chrome; }
});
