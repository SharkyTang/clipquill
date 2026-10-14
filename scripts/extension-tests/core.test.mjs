import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {shareURL, workIdFromURL, selectMP4, filenameFor, capturePage} from '../../outputs/douyin-independent-extension/core.mjs';
import {readNormalPage} from '../../outputs/douyin-independent-extension/navigation.mjs';
const id = '7689864994510343451';
const cdn = 'https://v3-dy-o.zjcdn.com/media.mp4?opaque=unchanged';
const variant = (height = 720, extra = {}) => ({width: height * 16 / 9, height, size: 123, format: 'mp4', isH265: 0, urls: [cdn], ...extra});
const work = extra => ({id, title: '测试作品', durationMs: 300000, webpageDownloadEnabled: false, variants: [variant()], ...extra});
function capture(data, url = `https://www.douyin.com/video/${id}`) {
  const page = new URL(url);
  return vm.runInNewContext(`(${capturePage.toString()})()`, {location: page, URL, document: {querySelectorAll: () => [{textContent: encodeURIComponent(JSON.stringify(data))}]}});
}

test('share text accepts official URL, rejects confusing origins and credentials', () => {
  assert.equal(shareURL('分享 https://v.douyin.com/bbXEZdKRShg/ 复制这段文字'), 'https://v.douyin.com/bbXEZdKRShg/');
  for (const url of ['https://v.douyin.com.evil.test/abc', 'https://me@v.douyin.com/abc', 'http://v.douyin.com/abc', 'https://www.douyin.com/user/self']) assert.throws(() => shareURL(url));
});
test('long IDs stay strings and modal conflicts are rejected', () => {
  assert.equal(workIdFromURL(`https://www.douyin.com/video/${id}`), id);
  assert.equal(workIdFromURL(`https://www.douyin.com/user/self?modal_id=${id}`), id);
  assert.equal(workIdFromURL(`https://www.douyin.com/video/${id}?modal_id=1111111111111111111`), null);
});
test('short link follows normal navigation and waits through a share-domain redirect', async () => {
  const states = [{url:'https://v.douyin.com/bbXEZdKRShg/',status:'loading'}, {status:'complete'}, {url:`https://www.douyin.com/video/${id}`,status:'loading'}, {url:`https://www.douyin.com/video/${id}`,status:'complete'}];
  let captureCount=0;
  const result=await readNormalPage(7,null,{getTab:async()=>states.shift(),pause:async()=>{},capture:async()=>{captureCount++;return work();}});
  assert.equal(result.id,id); assert.equal(captureCount,1);
});
test('navigation refuses a recommendation after first observing the target ID',async()=>{
  const states=[{url:`https://www.douyin.com/video/${id}`,status:'loading'},{url:'https://www.douyin.com/video/1111111111111111111',status:'complete'}];
  await assert.rejects(readNormalPage(7,null,{getTab:async()=>states.shift(),pause:async()=>{},capture:async()=>{throw new Error('must not read wrong work');}}),/其他作品/);
});
test('navigation times out without widening origin permissions or inventing a work ID',async()=>{
  await assert.rejects(readNormalPage(7,null,{getTab:async()=>({status:'complete'}),pause:async()=>{},capture:async()=>{}},2),/未能/);
});
test('missing canonical SSR opens the observed modal route once, preserving exact identity',async()=>{
  let url=`https://www.douyin.com/video/${id}`, moves=0, reads=0;
  const result=await readNormalPage(7,id,{getTab:async()=>({url,status:'complete'}),pause:async()=>{},navigate:async(tab,next)=>{assert.equal(tab,7);moves++;url=next;},capture:async()=>++reads===1?{code:'MISSING_WORK',error:'no SSR'}:work()});
  assert.equal(result.id,id); assert.equal(moves,1); assert.equal(url,`https://www.douyin.com/user/self?modal_id=${id}`);
});
test('missing modal data and stale work fail without endless navigation',async()=>{
  for (const failure of [{code:'MISSING_WORK',error:'missing'}, {error:'mismatched'}]) {
    let url=`https://www.douyin.com/video/${id}`,moves=0;
    await assert.rejects(readNormalPage(7,id,{getTab:async()=>({url,status:'complete'}),pause:async()=>{},navigate:async(_,next)=>{moves++;url=next;},capture:async()=>failure}),/missing|mismatched/);
    assert.equal(moves,failure.code==='MISSING_WORK'?1:0);
  }
});
test('never substitutes recommendation or encrypted/DASH candidate', () => {
  assert.throws(() => selectMP4(work(), '1111111111111111111'));
  for (const v of [variant(720, {format: 'dash'}), variant(720, {protected: true}), variant(720, {isH265: 1})]) assert.throws(() => selectMP4(work({variants: [v]}), id));
});
test('uses actual quality and canonical original URL; UI flag is not network access evidence', () => {
  const w = work({variants: [variant(), variant(1080, {width: 1920, size: 456})]});
  assert.equal(selectMP4(w, id, 720).height, 720);
  assert.equal(selectMP4(w, id, 1080).height, 1080);
  assert.equal(selectMP4(w, id).url, cdn);
  assert.equal(w.webpageDownloadEnabled, false);
});
test('rejects non-CDN URLs and impossible sizes', () => {
  for (const value of ['https://v3-dy-o.zjcdn.com.evil.test/a', 'file:///tmp/a', 'http://v3-dy-o.zjcdn.com/a', 'https://user:password@v3-dy-o.zjcdn.com/a']) assert.throws(() => selectMP4(work({variants: [variant(720, {urls: [value]})]}), id));
  assert.throws(() => selectMP4(work({variants: [variant(720, {size: -1})]}), id));
});
test('capture returns only target media fields, no session data', () => {
  const v = variant();
  const data = {app: {sessionToken: 'SECRET', videoDetail: {awemeId: id, desc: '目标', authenticationToken: 'SECRET', download: {allowDownload: false}, video: {duration: 300000, bitRateList: [{...v, dataSize: v.size, playAddr: [{src: cdn}], playerAccessKey: ''}]}}}};
  const result = capture(data);
  assert.equal(result.id, id); assert.equal(result.variants[0].urls[0], cdn);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  data.app.videoDetail.awemeId = '1111111111111111111';
  assert.ok(capture(data).error);
});
test('SPA stale initialization fails closed even if another work is present', () => {
  const data = {app: {videoDetail: {awemeId: '1111111111111111111'}}, recommendation: {awemeId: id, video: {}}};
  assert.ok(capture(data).error);
});
test('capture exposes bounded optional image and author labels from the actual page field shape', () => {
  const cover = 'https://p3-pc-sign.douyinpic.com/cover.jpg?opaque=kept';
  const fallback = 'https://p9-pc-sign.douyinpic.com/cover.jpg';
  const avatar = 'https://p3-pc.douyinpic.com/avatar.jpg';
  const data = {app:{videoDetail:{awemeId:id,desc:'目标',authorInfo:{nickname:'真实作者',uid:'PRIVATE_UID',secUid:'PRIVATE_SEC_UID',secret:true,avatarThumb:{urlList:[avatar]},avatarUri:avatar},video:{duration:1000,bitRateList:[],cover,coverUrlList:[cover],originCover:cover,originCoverUrlList:[fallback]}}}};
  const result = capture(data);
  assert.deepEqual([...result.coverURLs], [cover, fallback]);
  assert.deepEqual([...result.avatarURLs], [avatar]);
  assert.equal(result.authorName, '真实作者');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  const missing = capture({app:{videoDetail:{awemeId:id,video:{duration:1000,bitRateList:[]}}}});
  assert.deepEqual([...missing.coverURLs], []);
  assert.deepEqual([...missing.avatarURLs], []);
  assert.equal(missing.authorName, null);
});
test('optional display fields reject unsafe images and bound untrusted author text', () => {
  const hostile = ['javascript:alert(1)','data:image/png;base64,abc','https://user:pass@p3-pc-sign.douyinpic.com/a','http://p3-pc-sign.douyinpic.com/a','https://p3-pc-sign.douyinpic.com.evil.test/a','https://unseen.douyinpic.com/a'];
  const data = {app:{videoDetail:{awemeId:id,authorInfo:{nickname:'\u0000<img onerror=alert(1)>'.repeat(20),avatarThumb:{urlList:hostile}},video:{duration:1000,bitRateList:[],cover:hostile[0],coverUrlList:hostile,originCoverUrlList:hostile}}}};
  const result = capture(data);
  assert.deepEqual([...result.coverURLs], []);
  assert.deepEqual([...result.avatarURLs], []);
  assert.equal(result.authorName.length, 120);
  assert.ok(!result.authorName.includes('\u0000'));
  // Text is returned as a label, never interpolated into HTML or evaluated.
  assert.ok(result.authorName.startsWith('<img onerror=alert(1)>'));
});
test('canonical page without SSR work is distinguished from a different work',()=>{
  assert.equal(capture({app:{user:{}}}).code,'MISSING_WORK');
  assert.equal(capture({app:{videoDetail:{awemeId:'1111111111111111111'}}}).code,undefined);
});
test('filename stays inside chosen download folder', () => {
  const name = filenameFor(work({title: '../x/../../:bad\\file?'}), variant());
  assert.ok(name.startsWith('抖音独立导出/')); assert.ok(!name.includes('..'));
  assert.equal(name.split('/').length, 2);
});
