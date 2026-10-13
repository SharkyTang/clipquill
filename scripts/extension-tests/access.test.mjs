import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {captureAccessState} from '../../outputs/douyin-independent-extension/access.mjs';
import {readNormalPage} from '../../outputs/douyin-independent-extension/navigation.mjs';

const id = '7689864994510343451', url = `https://www.douyin.com/video/${id}`;
function scan({dialogs = [], captcha = [], login = [], path = '/'} = {}) {
  const node = (text, hidden = false) => ({textContent: text, closest: () => hidden, getBoundingClientRect: () => ({width: 100, height: 100})});
  const document = {querySelectorAll: selector => selector.includes('role="dialog"') ? dialogs.map(([text, hidden]) => node(text, hidden)) : selector.includes('captcha') ? captcha.map(([text, hidden]) => node(text, hidden)) : login.map(([text, hidden]) => node(text, hidden))};
  return vm.runInNewContext(`(${captureAccessState.toString()})()`, {document, location: new URL(`https://www.douyin.com${path}`), getComputedStyle: () => ({display: 'block', visibility: 'visible', opacity: '1'})});
}
test('visible login dialogs and verification are recognized without returning page text', () => {
  assert.equal(scan({dialogs: [['扫码登录']]})?.type, 'login');
  assert.equal(scan({captcha: [['private challenge']]})?.type, 'verification');
  assert.equal(scan({dialogs: [['请完成安全验证']]})?.type, 'verification');
  assert.equal(scan({path: '/login'})?.type, 'login');
  assert.equal(JSON.stringify(scan({dialogs: [['手机号登录 private account']]})), '{"type":"login"}');
});
test('hidden dialogs, ordinary login buttons and unrelated dialogs do not trigger focus', () => {
  assert.equal(scan({dialogs: [['扫码登录', true]], captcha: [['安全验证', true]]}), null);
  assert.equal(scan({login: [['登录']]}), null);
  assert.equal(scan({dialogs: [['分享这条视频']]}), null);
});
test('a passive login offer does not block a readable target work', async () => {
  const work = {id};
  assert.equal(await readNormalPage(7,id,{getTab: async () => ({url, status: 'complete'}), capture: async () => work, getAccessState: async () => ({type: 'login'}), pause: async () => {}}), work);
});
test('a login offer does not turn malformed data or a stale work into a login requirement', async () => {
  for (const message of ['页面数据格式已变化', '初始化数据不是当前作品']) {
    await assert.rejects(readNormalPage(7,id,{getTab: async () => ({url, status:'complete'}), capture: async () => ({error:message}), getAccessState: async () => ({type:'login'}), pause: async () => {}}), error => error.message === message && error.code === undefined);
  }
});
test('blocking login preserves identity and avoids changing the page before user intervention', async () => {
  let navigated = false;
  await assert.rejects(readNormalPage(7,id,{getTab: async () => ({url, status: 'complete'}), capture: async () => ({code: 'MISSING_WORK', error: 'missing'}), getAccessState: async () => ({type: 'login'}), navigate: async () => { navigated = true; }, pause: async () => {}}), error => error.code === 'LOGIN_REQUIRED' && error.expectedId === id);
  assert.equal(navigated, false);
});
test('verification interrupts even if stale work data is still in the DOM', async () => {
  await assert.rejects(readNormalPage(7,id,{getTab: async () => ({url, status: 'complete'}), capture: async () => { throw new Error('must not read through verification'); }, getAccessState: async () => ({type: 'verification'}), pause: async () => {}}), error => error.code === 'VERIFICATION_REQUIRED');
});
test('login without a work URL is distinguished from a generic redirect timeout', async () => {
  await assert.rejects(readNormalPage(7,id,{getTab: async () => ({url: 'https://www.douyin.com/login', status: 'complete'}), capture: async () => {}, getAccessState: async () => ({type: 'login'}), pause: async () => {}}), error => error.code === 'LOGIN_REQUIRED');
});
test('retry after login returns to the original link once, preserving exact identity', async () => {
  let current = 'https://www.douyin.com/', moves = 0;
  const result = await readNormalPage(7,id,{getTab: async () => ({url: current, status: 'complete'}), capture: async () => ({id}), getAccessState: async () => null, resumeURL: url, navigate: async (_, value) => { current = value; moves++; }, pause: async () => {}});
  assert.equal(result.id,id); assert.equal(moves,1); assert.equal(current,url);
});
test('retry does not reset a verification that the user has yet to finish', async () => {
  let moves = 0;
  await assert.rejects(readNormalPage(7,id,{getTab: async () => ({url: 'https://www.douyin.com/', status: 'complete'}), capture: async () => {}, getAccessState: async () => ({type: 'verification'}), resumeURL: url, navigate: async () => { moves++; }, pause: async () => {}}), error => error.code === 'VERIFICATION_REQUIRED');
  assert.equal(moves,0);
});
test('login dialogs appearing after load are detected before a generic missing-data error', async () => {
  let checks = 0;
  await assert.rejects(readNormalPage(7,id,{getTab: async () => ({url, status: 'complete'}), capture: async () => ({code: 'MISSING_INIT', error: 'missing'}), getAccessState: async () => ++checks < 2 ? null : {type: 'login'}, pause: async () => {}}), error => error.code === 'LOGIN_REQUIRED');
  assert.equal(checks,2);
});
