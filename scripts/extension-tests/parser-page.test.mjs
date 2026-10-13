import test from 'node:test';
import assert from 'node:assert/strict';
import {createParserPage} from '../../outputs/douyin-independent-extension/parser-page.mjs';
import {accessError} from '../../outputs/douyin-independent-extension/access.mjs';

const id = '7689864994510343451', other = '1111111111111111111';
const url = `https://www.douyin.com/video/${id}`;
function fixture() {
  let next = 10;
  const states = new Map(), saved = {}, changes = [], focus = [], reads = [];
  const tabs = {
    async create(options) { const tab = {id: next++, windowId: 2, status: 'complete', ...options}; states.set(tab.id, tab); changes.push({kind: 'create', ...options}); return {...tab}; },
    async get(tabId) { if (!states.has(tabId)) throw new Error('No tab'); return {...states.get(tabId)}; },
    async update(tabId, options) { if (!states.has(tabId)) throw new Error('No tab'); Object.assign(states.get(tabId), options); changes.push({kind: 'update', tabId, ...options}); return {...states.get(tabId)}; }
  };
  const storage = {
    async get(key) { return {[key]: structuredClone(saved[key])}; },
    async set(value) { Object.assign(saved, structuredClone(value)); },
    async remove(key) { delete saved[key]; }
  };
  const deps = {tabs, storage, windows: {async update(windowId, value) { focus.push({windowId, ...value}); }},
    async readPage(tabId, expectedId, options) { reads.push({tabId, expectedId, ...options}); return {id: expectedId || id}; }};
  return {deps, tabs, states, saved, changes, focus, reads, manager: () => createParserPage(deps)};
}

test('consecutive links and reopened tool/worker use the same inactive parser tab', async () => {
  const f = fixture(), manager = f.manager();
  const first = await manager.resolve({url, windowId: 4});
  const second = await manager.resolve({url: `https://www.douyin.com/video/${other}`});
  const reopened = await f.manager().resolve({url});
  assert.equal(first.tabId, second.tabId); assert.equal(reopened.tabId, first.tabId);
  assert.equal(f.changes.filter(c => c.kind === 'create').length, 1);
  assert.equal(f.changes[0].active, false); assert.equal(f.changes[0].windowId, 4);
  assert.ok(f.changes.every(c => c.active !== true)); assert.deepEqual(f.focus, []);
});
test('closing the parser recreates one tab and retry reads the correct original work', async () => {
  const f = fixture(), manager = f.manager(), first = await manager.resolve({url});
  f.states.delete(first.tabId);
  const retried = await manager.resolve({url, retry: true});
  assert.notEqual(retried.tabId, first.tabId); assert.equal(f.states.size, 1);
  assert.equal(f.reads.at(-1).expectedId, id); assert.deepEqual(f.focus, []);
});
test('a user navigation to another site is preserved instead of being overwritten', async () => {
  const f = fixture(), manager = f.manager(), first = await manager.resolve({url});
  f.states.get(first.tabId).url = 'https://example.org/';
  const next = await manager.resolve({url});
  assert.notEqual(next.tabId, first.tabId); assert.equal(f.states.get(first.tabId).url, 'https://example.org/');
});
test('login and verification focus the parser, but retries preserve its current page', async () => {
  for (const type of ['login', 'verification']) {
    const f = fixture(); let blocked = true;
    f.deps.readPage = async () => { if (blocked) throw accessError({type}); return {id}; };
    const manager = f.manager();
    await assert.rejects(manager.resolve({url}), error => error.tabId === 10 && error.code === (type === 'login' ? 'LOGIN_REQUIRED' : 'VERIFICATION_REQUIRED'));
    assert.deepEqual(f.focus, [{windowId: 2, focused: true}]);
    const count = f.changes.length;
    blocked = false;
    const result = await manager.resolve({url, retry: true});
    assert.equal(result.tabId, 10); assert.equal(f.changes.length, count);
  }
});
test('short-link retries retain the known work ID even after returning from login', async () => {
  const f = fixture(); let blocked = true;
  f.deps.readPage = async (tabId, expectedId, options) => {
    if (blocked) { const error = accessError({type: 'login'}); error.expectedId = id; throw error; }
    assert.equal(expectedId, id); assert.equal(options.resumeURL, 'https://v.douyin.com/example/'); return {id};
  };
  const manager = f.manager(), short = 'https://v.douyin.com/example/';
  await assert.rejects(manager.resolve({url: short}));
  blocked = false;
  f.states.get(10).url = 'https://www.douyin.com/';
  await manager.resolve({url: short, retry: true});
  assert.equal(f.changes.filter(c => c.kind === 'create').length, 1);
});
test('generic parsing errors never focus a tab and still release the manager', async () => {
  const f = fixture(); let broken = true;
  f.deps.readPage = async () => { if (broken) throw new Error('页面数据格式已变化'); return {id}; };
  const manager = f.manager();
  await assert.rejects(manager.resolve({url}), error => error.tabId === 10 && /格式/.test(error.message));
  assert.deepEqual(f.focus, []); assert.ok(f.changes.every(c => c.active !== true));
  broken = false;
  assert.equal((await manager.resolve({url, retry: true})).tabId, 10);
});
test('existing user tabs are read without being adopted as the managed parser', async () => {
  const f = fixture(), userTab = await f.tabs.create({url, active: true});
  f.changes.length = 0;
  const manager = f.manager();
  assert.equal((await manager.resolve({existingTabId: userTab.id})).tabId, userTab.id);
  assert.deepEqual(f.changes, []); assert.deepEqual(f.saved, {});
  assert.notEqual((await manager.resolve({url})).tabId, userTab.id);
});
test('simultaneous tool pages cannot navigate the parser out from under an active read', async () => {
  const f = fixture(); let finish, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  f.deps.readPage = async () => { entered(); return new Promise(resolve => { finish = resolve; }); };
  const manager = f.manager(), first = manager.resolve({url});
  await waiting;
  await assert.rejects(manager.resolve({url: `https://www.douyin.com/video/${other}`}), /另一个工具页/);
  assert.equal(f.changes.length, 1); finish({id}); await first;
});
test('the first-use login action opens the same parser and later resolves in the background', async () => {
  const f = fixture(), manager = f.manager();
  const login = await manager.openLogin();
  const result = await manager.resolve({url});
  assert.equal(login.tabId, result.tabId); assert.equal(f.focus.length, 1);
  assert.equal(f.changes.filter(c => c.kind === 'create').length, 1);
  assert.equal(f.changes.at(-1).active, undefined);
});
