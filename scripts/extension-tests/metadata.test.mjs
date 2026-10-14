import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveVideoInfo, safeImageURL} from '../../outputs/douyin-independent-extension/metadata.mjs';

const id = '7689864994510343451';
const cover = 'https://p3-pc-sign.douyinpic.com/real-cover.jpg?opaque=unchanged';
const avatar = 'https://p3-pc.douyinpic.com/real-avatar.jpg';
const work = extra => ({id, pageURL: `https://www.douyin.com/video/${id}`, title: '真实页面标题', durationMs: 300000, ...extra});
const candidate = {width: 1280, height: 720, size: 27594766, url: 'https://v3-dy-o.zjcdn.com/media.mp4'};

test('video card uses existing metadata and explicitly labels expected file size', () => {
  const info = deriveVideoInfo(work(), candidate);
  assert.equal(info.platform, '抖音');
  assert.equal(info.title, '真实页面标题');
  assert.equal(info.durationLabel, '05:00');
  assert.equal(info.resolutionLabel, '1280 × 720');
  assert.equal(info.sizeLabel, '26.3 MiB');
  assert.equal(info.sizeSource, '页面标称');
  assert.equal(info.coverURL, null);
  assert.equal(info.avatarURL, null);
  assert.equal(info.authorName, null);
  assert.equal(info.previewURL, null, 'a CDN URL alone cannot establish current playback availability');
});

test('only an exactly verified completed/reused file upgrades the size source', () => {
  assert.equal(deriveVideoInfo(work(), candidate, {verifiedBytes: candidate.size}).sizeSource, '本地文件已核对');
  for (const verifiedBytes of [0, -1, candidate.size - 1, Infinity, String(candidate.size)]) {
    assert.equal(deriveVideoInfo(work(), candidate, {verifiedBytes}).sizeSource, '页面标称');
  }
});

test('missing and invalid fields stay unknown without placeholder measurements', () => {
  for (const durationMs of [null, 0, -1, Infinity, NaN, '300000']) {
    const info = deriveVideoInfo(work({durationMs, title: ''}), {width: 0, height: 720, size: -1});
    assert.equal(info.durationLabel, '未知');
    assert.equal(info.resolutionLabel, '未知');
    assert.equal(info.sizeLabel, '未知');
    assert.equal(info.sizeSource, null);
    assert.equal(info.title, '标题未知');
  }
  assert.equal(deriveVideoInfo().platform, '未知');
  assert.equal(deriveVideoInfo(work({durationMs: 3661000}), candidate).durationLabel, '1:01:01');
});

test('optional source images and author are limited to the verified current work', () => {
  const data = work({coverURLs: ['https://untrusted.test/image.jpg', cover], avatarURLs: [avatar], authorName: ' 作者\u0000 '});
  const info = deriveVideoInfo(data, candidate);
  assert.equal(info.coverURL, cover);
  assert.equal(info.avatarURL, avatar);
  assert.equal(info.authorName, '作者');
  for (const pageURL of [undefined, 'https://www.douyin.com/video/1111111111111111111', 'https://evil.test/video/' + id]) {
    const mismatched = deriveVideoInfo({...data, pageURL}, candidate);
    assert.equal(mismatched.platform, '未知');
    assert.equal(mismatched.coverURL, null);
    assert.equal(mismatched.avatarURL, null);
    assert.equal(mismatched.authorName, null);
  }
});

test('image display accepts only observed exact HTTPS image hosts', () => {
  assert.equal(safeImageURL(cover), cover);
  assert.equal(safeImageURL(avatar), avatar);
  assert.equal(safeImageURL('https://p9-pc-sign.douyinpic.com/cover.jpg'), 'https://p9-pc-sign.douyinpic.com/cover.jpg');
  for (const value of [
    'data:image/png;base64,abc', 'javascript:alert(1)', 'file:///tmp/a.png',
    'http://p3-pc-sign.douyinpic.com/a', 'https://user:pass@p3-pc-sign.douyinpic.com/a',
    'https://p3-pc-sign.douyinpic.com:444/a', 'https://p3-pc-sign.douyinpic.com.evil.test/a',
    'https://p3-pc-sign.douyinpic.com\n.evil.test/a', ' https://p3-pc-sign.douyinpic.com/a',
    'https://unseen.douyinpic.com/a', null, {}, 'https://p3-pc-sign.douyinpic.com/' + 'x'.repeat(8192)
  ]) assert.equal(safeImageURL(value), null, String(value));
});

test('view formatting does not mutate candidate, source, or create a playback claim', () => {
  const data = Object.freeze(work({coverURLs: Object.freeze([cover]), authorName: '<img src=x onerror=alert(1)>'}));
  const chosen = Object.freeze({...candidate});
  const info = deriveVideoInfo(data, chosen);
  assert.equal(info.authorName, '<img src=x onerror=alert(1)>', 'the binder must render this plain label with textContent');
  assert.equal(data.coverURLs[0], cover);
  assert.equal(chosen.size, candidate.size);
  assert.equal(info.previewURL, null);
});
