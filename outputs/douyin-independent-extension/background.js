import {capturePage} from './core.mjs';
import {captureAccessState} from './access.mjs';
import {readNormalPage} from './navigation.mjs';
import {createParserPage} from './parser-page.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function capture(tabId, func) {
  return (await chrome.scripting.executeScript({target: {tabId}, func}))[0]?.result;
}
const parser = createParserPage({
  tabs: chrome.tabs, windows: chrome.windows, storage: chrome.storage.session,
  readPage: (tabId, expectedId, {resumeURL}) => readNormalPage(tabId, expectedId, {
    getTab: id => chrome.tabs.get(id), navigate: (id, url) => chrome.tabs.update(id, {url}), pause,
    capture: id => capture(id, capturePage),
    resumeURL, getAccessState: async (id, value) => {
      let url;
      try { url = new URL(value); } catch { return null; }
      if (url.protocol !== 'https:' || !['www.douyin.com', 'v.douyin.com'].includes(url.hostname)) return null;
      return capture(id, captureAccessState);
    }
  })
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('tool.html')) return false;
  let action;
  if (message?.action === 'resolve-douyin') action = () => parser.resolve({url: message.url, existingTabId: message.existingTabId, retry: message.retry === true, windowId: sender.tab?.windowId});
  else if (message?.action === 'login-douyin') action = () => parser.openLogin({windowId: sender.tab?.windowId});
  else return false;
  action().then(result => respond({ok: true, ...result})).catch(error => respond({ok: false, error: error.message || '抖音页面读取失败。', code: error.code, tabId: error.tabId}));
  return true;
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({url: chrome.runtime.getURL('tool.html')});
});
