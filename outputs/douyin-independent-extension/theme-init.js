/* Load this local, classic script in <head> before the stylesheet. It only
 * changes theme attributes; task, editor and draft state stay untouched. */
(() => {
  'use strict';
  const KEY = 'clipquill.ui.theme.v1';
  const root = document.documentElement;
  const valid = value => value === 'light' || value === 'dark' || value === 'system';
  const normalize = value => valid(value) ? value : 'system';
  const media = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const storage = globalThis.chrome?.storage?.local;
  const storageEvents = globalThis.chrome?.storage?.onChanged;
  let preference = 'system', disposed = false, mediaListening = false;
  let select = null, state = null, error = '', mutationRevision = 0;
  let userRevision = 0, queuedWrite = null, activeWrite = null;
  // Chrome emits changes in storage order. Entries also suppress an older own
  // write's echo while a newer local selection is waiting to be persisted.
  const ownEchoes = [];

  try { preference = normalize(window.localStorage.getItem(KEY)); } catch { /* The enum cache is optional. */ }

  function renderStatus() {
    if (!state || disposed) return;
    state.textContent = error || (activeWrite || queuedWrite ? '正在保存主题…' : '');
    state.hidden = !state.textContent;
    state.dataset.state = error ? 'error' : 'pending';
  }

  function onSystemChange() {
    if (!disposed && preference === 'system') apply(preference);
  }

  function listenToSystem(enabled) {
    if (!media || mediaListening === enabled) return;
    if (enabled) {
      if (media.addEventListener) media.addEventListener('change', onSystemChange);
      else media.addListener?.(onSystemChange);
    } else {
      if (media.removeEventListener) media.removeEventListener('change', onSystemChange);
      else media.removeListener?.(onSystemChange);
    }
    mediaListening = enabled;
  }

  function apply(value) {
    if (disposed) return;
    preference = normalize(value);
    root.dataset.themePreference = preference;
    root.dataset.theme = preference === 'system' ? (media?.matches ? 'dark' : 'light') : preference;
    root.style.colorScheme = root.dataset.theme;
    listenToSystem(preference === 'system');
    if (select) select.value = preference;
    try { window.localStorage.setItem(KEY, preference); } catch { /* Authoritative persistence uses chrome.storage. */ }
  }

  async function flushWrites() {
    if (activeWrite || !queuedWrite || disposed) return;
    const write = queuedWrite;
    queuedWrite = null;
    activeWrite = write;
    ownEchoes.push(write);
    renderStatus();
    try {
      if (!storage?.set) throw new Error('storage unavailable');
      await storage.set({[KEY]: write.value});
      if (!disposed && write.revision === userRevision) error = '';
    } catch {
      const index = ownEchoes.indexOf(write);
      if (index !== -1) ownEchoes.splice(index, 1);
      if (!disposed && write.revision === userRevision) error = '主题保存失败，当前页面仍可使用；请重新选择主题以重试。';
    } finally {
      activeWrite = null;
      renderStatus();
      if (queuedWrite && !disposed) void flushWrites();
    }
  }

  function setPreference(value) {
    if (disposed) return;
    mutationRevision += 1;
    userRevision += 1;
    error = '';
    apply(value);
    queuedWrite = {value: preference, revision: userRevision};
    void flushWrites();
  }

  function onSelect() { setPreference(select.value); }

  function onStorageChange(changes, areaName) {
    if (disposed || areaName !== 'local' || !Object.prototype.hasOwnProperty.call(changes, KEY)) return;
    mutationRevision += 1;
    const value = normalize(changes[KEY].newValue);
    const echoIndex = ownEchoes.findIndex(write => write.value === value);
    const echo = echoIndex === -1 ? null : ownEchoes[echoIndex];
    // Earlier writes may have been no-ops, which produce no change event.
    if (echo) ownEchoes.splice(0, echoIndex + 1);
    if (echo && echo.revision < userRevision) return;
    if ((activeWrite || queuedWrite) && value !== (queuedWrite || activeWrite).value) return;
    if (!echo) {
      // An accepted external change is also an ordering barrier: completed
      // writes before it either emitted their echo already or were no-ops.
      // Keeping those no-op entries would misclassify a later remote choice.
      for (let index = ownEchoes.length - 1; index >= 0; index -= 1) {
        if (ownEchoes[index] !== activeWrite) ownEchoes.splice(index, 1);
      }
    }
    error = '';
    apply(value);
    renderStatus();
    // Never write back from a storage event: other open pages share this key.
  }

  function bindControls() {
    if (disposed) return;
    select = document.getElementById('themePreference');
    state = document.getElementById('themeState');
    if (select) {
      select.value = preference;
      select.addEventListener('change', onSelect);
    }
    renderStatus();
  }

  function onPageHide(event) { if (!event.persisted) dispose(); }

  function dispose() {
    if (disposed) return;
    listenToSystem(false);
    disposed = true;
    select?.removeEventListener('change', onSelect);
    document.removeEventListener('DOMContentLoaded', bindControls);
    storageEvents?.removeListener?.(onStorageChange);
    window.removeEventListener('pagehide', onPageHide);
  }

  apply(preference);
  storageEvents?.addListener?.(onStorageChange);
  window.addEventListener('pagehide', onPageHide);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindControls, {once: true});
  else bindControls();

  const initialRevision = mutationRevision;
  void (async () => {
    try {
      if (!storage?.get) throw new Error('storage unavailable');
      const saved = await storage.get(KEY);
      if (disposed || initialRevision !== mutationRevision) return;
      error = '';
      apply(saved?.[KEY]);
    } catch {
      if (disposed || initialRevision !== mutationRevision) return;
      error = '无法读取主题偏好，暂用当前主题；仍可切换并重试保存。';
    }
    renderStatus();
  })();

  window.ClipQuillTheme = Object.freeze({
    setPreference,
    getState: () => ({preference, resolvedTheme: root.dataset.theme, saving: Boolean(activeWrite || queuedWrite), error}),
    dispose
  });
})();
