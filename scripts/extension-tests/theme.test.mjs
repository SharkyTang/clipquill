import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const KEY = 'clipquill.ui.theme.v1';
const source = readFileSync(new URL('../../outputs/douyin-independent-extension/theme-init.js', import.meta.url), 'utf8');
const tick = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function target() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, value = {}) { for (const listener of [...(listeners.get(type) || [])]) listener(value); }
  };
}
function render({dark = false, cached, saved, get, set, cacheThrows = false, loading = false, storageAvailable = true} = {}) {
  const cache = new Map(cached === undefined ? [] : [[KEY, cached]]), writes = [], storageListeners = new Set();
  const select = {...target(), value: ''}, state = {textContent: '', hidden: true, dataset: {}};
  const root = {dataset: {}, style: {}};
  const media = {...target(), matches: dark};
  const window = {...target(), matchMedia: () => media, localStorage: {
    getItem(key) { if (cacheThrows) throw new Error('cache blocked'); return cache.get(key) ?? null; },
    setItem(key, value) { if (cacheThrows) throw new Error('cache blocked'); cache.set(key, value); }
  }};
  const document = {...target(), documentElement: root, readyState: loading ? 'loading' : 'complete', getElementById: id => id === 'themePreference' ? select : state};
  const chrome = storageAvailable ? {storage: {
    local: {
      get: get || (async () => ({[KEY]: saved})),
      set: async value => { writes.push(value); if (set) await set(value); }
    },
    onChanged: {addListener: listener => storageListeners.add(listener), removeListener: listener => storageListeners.delete(listener)}
  }} : {};
  vm.runInNewContext(source, {window, document, chrome}, {filename: 'theme-init.js'});
  return {root, media, select, state, cache, writes, window, document, storageListeners,
    choose(value) { select.value = value; select.emit('change'); },
    change(value, area = 'local', key = KEY) { for (const listener of [...storageListeners]) listener({[key]: {newValue: value}}, area); },
    system(dark) { media.matches = dark; media.emit('change', {matches: dark}); }
  };
}

test('first launch follows light and dark systems before async storage and controls mount', async () => {
  for (const dark of [false, true]) {
    const f = render({dark, loading: true});
    assert.equal(f.root.dataset.themePreference, 'system');
    assert.equal(f.root.dataset.theme, dark ? 'dark' : 'light');
    assert.equal(f.root.style.colorScheme, dark ? 'dark' : 'light');
    f.document.emit('DOMContentLoaded');
    await tick();
    assert.equal(f.select.value, 'system');
    assert.deepEqual(f.writes, []);
  }
});

test('enum cache prevents a light flash while canonical storage remains authoritative', async () => {
  const read = deferred(), f = render({cached: 'dark', dark: false, get: () => read.promise});
  assert.equal(f.root.dataset.theme, 'dark');
  read.resolve({[KEY]: 'light'});
  await tick();
  assert.equal(f.root.dataset.theme, 'light');
  assert.equal(f.cache.get(KEY), 'light');
  assert.equal(f.select.value, 'light');
});

test('manual preference persists as an enum and survives reopening against the opposite system', async () => {
  const f = render();
  await tick();
  f.choose('dark');
  assert.equal(f.root.dataset.theme, 'dark');
  assert.equal(f.cache.get(KEY), 'dark');
  await tick();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0][KEY], 'dark');
  const reopened = render({saved: f.writes[0][KEY], dark: false});
  await tick();
  assert.equal(reopened.root.dataset.theme, 'dark');
  assert.equal(reopened.root.dataset.themePreference, 'dark');
});

test('system changes are observed only in system mode and resume when selected again', async () => {
  const f = render();
  await tick();
  f.system(true);
  assert.equal(f.root.dataset.theme, 'dark');
  f.choose('light');
  assert.equal(f.media.listeners.get('change').size, 0);
  f.system(false);
  f.system(true);
  assert.equal(f.root.dataset.theme, 'light');
  f.choose('system');
  assert.equal(f.media.listeners.get('change').size, 1);
  assert.equal(f.root.dataset.theme, 'dark');
});

test('a delayed startup read cannot override a newer user selection', async () => {
  const read = deferred(), f = render({get: () => read.promise});
  f.choose('dark');
  read.resolve({[KEY]: 'light'});
  await tick();
  assert.equal(f.select.value, 'dark');
  assert.equal(f.root.dataset.theme, 'dark');
});

test('a delayed startup read cannot override a change from another open page', async () => {
  const read = deferred(), f = render({get: () => read.promise});
  f.change('dark');
  read.resolve({[KEY]: 'light'});
  await tick();
  assert.equal(f.root.dataset.theme, 'dark');
  assert.deepEqual(f.writes, []);
});

test('rapid choices serialize writes, coalesce pending values and suppress stale own echoes', async () => {
  const requests = [], f = render({set() { const request = deferred(); requests.push(request); return request.promise; }});
  await tick();
  f.choose('dark');
  f.choose('light');
  f.choose('system');
  assert.equal(f.writes.length, 1);
  f.change('dark');
  assert.equal(f.select.value, 'system');
  requests[0].resolve();
  await tick();
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1][KEY], 'system');
  requests[1].resolve();
  await tick();
  f.change('system');
  assert.equal(f.window.ClipQuillTheme.getState().saving, false);
  assert.equal(f.select.value, 'system');
  f.change('light');
  assert.equal(f.select.value, 'light');
  assert.equal(f.writes.length, 2);
});

test('own change events delayed until after writes finish cannot revert the newest local choice', async () => {
  const requests = [], f = render({set() { const request = deferred(); requests.push(request); return request.promise; }});
  await tick();
  f.choose('dark');
  f.choose('light');
  requests[0].resolve();
  await tick();
  requests[1].resolve();
  await tick();
  f.change('dark');
  assert.equal(f.select.value, 'light');
  f.change('light');
  assert.equal(f.select.value, 'light');
  f.change('dark');
  assert.equal(f.select.value, 'dark');
  assert.equal(f.writes.length, 2);
});

test('a newer own echo retires a preceding no-op write so later remote choices still sync', async () => {
  const f = render({saved: 'system'});
  await tick();
  f.choose('system');
  await tick();
  f.choose('dark');
  await tick();
  // Setting the already stored system enum emits no event; only dark arrives.
  f.change('dark');
  f.change('system');
  assert.equal(f.select.value, 'system');
  assert.equal(f.writes.length, 2);
});

test('remote changes retire repeated completed no-op echoes before a remote return to that preference', async () => {
  const f = render({saved: 'dark'});
  await tick();
  f.choose('dark');
  await tick();
  f.choose('dark');
  await tick();
  // Both writes were no-ops in Chrome and therefore emit no storage events.
  f.change('light');
  assert.equal(f.select.value, 'light');
  f.change('dark');
  assert.equal(f.select.value, 'dark');
  assert.equal(f.root.dataset.theme, 'dark');
  assert.equal(f.writes.length, 2);
});

test('two open pages synchronize without storage event write loops', async () => {
  const a = render(), b = render({dark: true});
  await tick();
  a.choose('dark');
  await tick();
  a.change(a.writes[0][KEY]);
  b.change(a.writes[0][KEY]);
  assert.equal(b.root.dataset.themePreference, 'dark');
  b.system(false);
  assert.equal(b.root.dataset.theme, 'dark');
  assert.deepEqual(b.writes, []);
  b.choose('light');
  await tick();
  a.change(b.writes[0][KEY]);
  b.change(b.writes[0][KEY]);
  assert.equal(a.select.value, 'light');
  assert.equal(a.writes.length, 1);
  assert.equal(b.writes.length, 1);
});

test('only the theme key in local storage is processed; invalid and deleted values use system', async () => {
  const f = render({saved: 'dark', dark: false});
  await tick();
  f.change('light', 'sync');
  f.change('light', 'local', 'transcriptDraft');
  assert.equal(f.root.dataset.theme, 'dark');
  f.change('invalid');
  assert.equal(f.root.dataset.themePreference, 'system');
  f.change(undefined);
  assert.equal(f.root.dataset.theme, 'light');
  assert.deepEqual(f.writes, []);
  const invalidCache = render({cached: '{}', saved: {preference: 'dark'}, dark: true});
  await tick();
  assert.equal(invalidCache.root.dataset.themePreference, 'system');
});

test('read and write errors remain visible while theme switching remains usable', async () => {
  let rejectWrites = true;
  const f = render({get: async () => { throw new Error('read failed'); }, set: async () => { if (rejectWrites) throw new Error('write failed'); }});
  await tick();
  assert.match(f.state.textContent, /无法读取/);
  assert.equal(f.state.hidden, false);
  f.choose('dark');
  await tick();
  assert.equal(f.root.dataset.theme, 'dark');
  assert.match(f.state.textContent, /保存失败/);
  assert.equal(f.state.dataset.state, 'error');
  rejectWrites = false;
  f.choose('light');
  await tick();
  assert.equal(f.root.dataset.theme, 'light');
  assert.equal(f.state.hidden, true);
});

test('an obsolete read or write error never marks a newer saved preference as failed', async () => {
  const read = deferred(), firstWrite = deferred();
  let count = 0;
  const f = render({get: () => read.promise, set: () => ++count === 1 ? firstWrite.promise : Promise.resolve()});
  f.choose('dark');
  f.choose('light');
  read.reject(new Error('stale read'));
  firstWrite.reject(new Error('obsolete write'));
  await tick();
  assert.equal(f.root.dataset.theme, 'light');
  assert.equal(f.state.hidden, true);
  assert.equal(f.window.ClipQuillTheme.getState().error, '');
});

test('blocked local cache does not prevent chrome persistence; absent storage is explained', async () => {
  const f = render({cacheThrows: true});
  await tick();
  f.choose('dark');
  await tick();
  assert.equal(f.writes[0][KEY], 'dark');
  assert.equal(f.state.hidden, true);
  const unavailable = render({storageAvailable: false});
  await tick();
  assert.match(unavailable.state.textContent, /无法读取/);
  unavailable.choose('light');
  await tick();
  assert.match(unavailable.state.textContent, /保存失败/);
});

test('unload removes system, storage, DOM and control listeners without editing other content', async () => {
  const f = render();
  await tick();
  f.window.emit('pagehide', {persisted: false});
  assert.equal(f.media.listeners.get('change').size, 0);
  assert.equal(f.storageListeners.size, 0);
  assert.equal(f.select.listeners.get('change').size, 0);
  f.system(true);
  f.change('dark');
  f.choose('dark');
  assert.equal(f.root.dataset.theme, 'light');
  assert.deepEqual(f.writes, []);
});

test('unloading before DOM/storage initialization finishes leaves no late bindings', async () => {
  const read = deferred(), f = render({loading: true, get: () => read.promise});
  f.window.emit('pagehide', {persisted: false});
  f.document.emit('DOMContentLoaded');
  read.resolve({[KEY]: 'dark'});
  await tick();
  assert.equal(f.select.listeners.get('change'), undefined);
  assert.equal(f.root.dataset.theme, 'light');
  assert.equal(f.storageListeners.size, 0);
});
