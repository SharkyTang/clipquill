import {shareURL, workIdFromURL} from './core.mjs';

const stateKey = 'douyinParserPage-v1';
function supportedPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['www.douyin.com', 'v.douyin.com'].includes(url.hostname);
  } catch { return false; }
}

// One manager in the extension worker coordinates all tool pages. Only the tab
// created here is reused; unrelated tabs are never adopted or closed.
export function createParserPage({tabs, windows, storage, readPage}) {
  let busy = false;
  async function managedTab() {
    const saved = (await storage.get(stateKey))[stateKey];
    if (!Number.isInteger(saved?.tabId)) return null;
    let tab;
    try { tab = await tabs.get(saved.tabId); }
    catch { await storage.remove(stateKey); return null; }
    // A tab the user has taken to another site is no longer our parser page.
    if (!supportedPage(tab.pendingUrl || tab.url)) { await storage.remove(stateKey); return null; }
    return {tab, saved};
  }
  async function open(url, {retry = false, windowId} = {}) {
    const current = await managedTab();
    if (current && retry && current.saved.needsIntervention && current.saved.requestURL === url) return {tab: current.tab, expectedId: current.saved.expectedId || workIdFromURL(url), resumeURL: url};
    const tab = current
      ? await tabs.update(current.tab.id, {url})
      : await tabs.create({url, active: false, ...(Number.isInteger(windowId) ? {windowId} : {})});
    const expectedId = workIdFromURL(url);
    await storage.set({[stateKey]: {tabId: tab.id, requestURL: url, expectedId, needsIntervention: false}});
    return {tab, expectedId};
  }
  async function focus(tabId) {
    const tab = await tabs.update(tabId, {active: true});
    await windows.update(tab.windowId, {focused: true});
  }
  async function exclusive(action) {
    if (busy) throw new Error('另一个工具页正在读取抖音作品，请稍后重试。');
    busy = true;
    try { return await action(); }
    finally { busy = false; }
  }
  return {
    resolve: ({url, existingTabId, retry = false, windowId}) => exclusive(async () => {
      let tab, expectedId, resumeURL;
      try {
        if (existingTabId !== undefined && existingTabId !== null) {
          if (!Number.isInteger(existingTabId)) throw new Error('请先打开并选择目标抖音作品。');
          tab = await tabs.get(existingTabId);
          if (!workIdFromURL(tab.url)) throw new Error('所选页面不是明确的抖音作品，请刷新列表后重试。');
          expectedId = workIdFromURL(tab.url);
        } else ({tab, expectedId, resumeURL} = await open(shareURL(url), {retry, windowId}));
        const work = await readPage(tab.id, expectedId, {resumeURL});
        if (existingTabId == null) await storage.set({[stateKey]: {tabId: tab.id, requestURL: shareURL(url), expectedId: work.id, needsIntervention: false}});
        return {work, tabId: tab.id};
      } catch (error) {
        if (tab) error.tabId = tab.id;
        if (tab && ['LOGIN_REQUIRED', 'VERIFICATION_REQUIRED'].includes(error.code)) {
          if (existingTabId == null) await storage.set({[stateKey]: {tabId: tab.id, requestURL: shareURL(url), expectedId: error.expectedId || expectedId, needsIntervention: true}});
          try { await focus(tab.id); }
          catch { error.message += ' 自动打开失败，请点“打开待处理的抖音页面”。'; }
        }
        throw error;
      }
    }),
    openLogin: ({windowId} = {}) => exclusive(async () => {
      const {tab} = await open('https://www.douyin.com/', {windowId});
      await focus(tab.id);
      return {tabId: tab.id};
    })
  };
}
