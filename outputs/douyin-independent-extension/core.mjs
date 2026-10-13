export function shareURL(text) {
  const found = String(text).match(/https:\/\/[^\s<>"“”]+/);
  if (!found) throw new Error('请粘贴抖音分享链接。');
  let url;
  try { url = new URL(found[0].replace(/[，。；！）)]+$/, '')); }
  catch { throw new Error('分享链接格式不正确。'); }
  if (url.username || url.password || url.port || !['www.douyin.com', 'v.douyin.com'].includes(url.hostname)) {
    throw new Error('只支持抖音官方 HTTPS 分享链接。');
  }
  if (url.hostname === 'www.douyin.com' && !/^\/video\/\d{10,30}\/?$/.test(url.pathname)) {
    throw new Error('请使用单条视频链接。');
  }
  if (url.hostname === 'v.douyin.com' && !/^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    throw new Error('短链接格式不正确。');
  }
  return url.href;
}

export function workIdFromURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.douyin.com' || url.username || url.password || url.port) return null;
    const modal = url.searchParams.get('modal_id');
    const canonical = url.pathname.match(/^\/video\/(\d{10,30})\/?$/)?.[1];
    if (modal && canonical && modal !== canonical) return null;
    const id = modal || canonical;
    return /^\d{10,30}$/.test(id || '') ? id : null;
  } catch { return null; }
}

export function mediaURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!['v5-hl-mly-ov.zjcdn.com', 'v3-dy-o.zjcdn.com', 'v5-dy-ov-experiment.zjcdn.com'].includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function selectMP4(work, expectedId, maxHeight = 720) {
  if (!expectedId || work?.id !== expectedId) throw new Error('页面作品与目标链接不一致，已停止。');
  if (!Number.isFinite(work.durationMs) || work.durationMs <= 0) throw new Error('缺少有效作品时长。');
  const candidates = (Array.isArray(work.variants) ? work.variants : []).filter(v =>
    v.format === 'mp4' && v.isH265 === 0 && !v.protected &&
    Number.isSafeInteger(v.size) && v.size > 0 && v.size <= 2 * 1024 ** 3 &&
    Number.isInteger(v.width) && v.width > 0 && Number.isInteger(v.height) && v.height > 0 &&
    Array.isArray(v.urls) && v.urls.some(mediaURL)
  );
  if (!candidates.length) throw new Error('页面没有可直接保存的兼容 MP4；本原型不处理加密或分离音视频。');
  const preferred = candidates.filter(v => v.height <= maxHeight);
  const pool = preferred.length ? preferred : candidates;
  pool.sort((a, b) => preferred.length ? (b.height - a.height || b.size - a.size) : (a.height - b.height || b.size - a.size));
  const selected = pool[0];
  return {...selected, url: selected.urls.map(mediaURL).find(Boolean)};
}

export function filenameFor(work, candidate) {
  const title = String(work.title || '抖音视频').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').replace(/\.{2,}/g, '_').trim().slice(0, 55);
  return `抖音独立导出/${work.id}_${candidate.height}p_${title || '视频'}.mp4`;
}

// Serialized by chrome.scripting; all reads stay inside the normal page DOM.
export function capturePage() {
  if (location.protocol !== 'https:' || location.hostname !== 'www.douyin.com') return {error: '请先正常打开抖音作品页面。'};
  const pageURL = new URL(location.href);
  const canonical = pageURL.pathname.match(/^\/video\/(\d{10,30})\/?$/)?.[1];
  const modal = pageURL.searchParams.get('modal_id');
  if (modal && canonical && modal !== canonical) return {error: '作品地址存在冲突。'};
  const expected = modal || canonical;
  if (!/^\d{10,30}$/.test(expected || '')) return {error: '当前页面没有明确作品 ID。'};
  const nodes = document.querySelectorAll('script#RENDER_DATA[type="application/json"]');
  if (nodes.length !== 1) return {error: '页面未提供初始化数据；请完成正常加载或登录后重试。'};
  const text = nodes[0].textContent || '';
  if (text.length > 16 * 1024 * 1024) return {error: '页面数据过大，已停止。'};
  let data;
  try { data = JSON.parse(text.trim().startsWith('{') ? text : decodeURIComponent(text)); }
  catch { return {error: '页面数据格式已变化，无法解析。'}; }
  // The server-rendered current work is authoritative. Never select a recommendation.
  const work = data?.app?.videoDetail;
  if (!work) return {code: 'MISSING_WORK', error: '当前页面首屏未包含作品数据。'};
  if (typeof work?.awemeId !== 'string' || work.awemeId !== expected) return {error: '初始化数据不是当前作品；请在原作品页面刷新后重试。'};
  const video = work.video;
  if (!video || !Array.isArray(video.bitRateList)) return {error: '这条作品没有受支持的视频数据。'};
  return {
    id: work.awemeId, pageURL: location.href,
    title: String(work.itemTitle || work.desc || '').slice(0, 600),
    durationMs: video.duration,
    webpageDownloadEnabled: typeof work.download?.allowDownload === 'boolean' ? work.download.allowDownload : null,
    variants: video.bitRateList.map(v => ({
      width: v.width, height: v.height, size: v.dataSize, format: v.format || v.videoFormat,
      isH265: v.isH265, gearName: v.gearName,
      protected: !!(v.playerAccessKey || v.encrypt_info || v.encrypted || v.drm),
      urls: (Array.isArray(v.playAddr) ? v.playAddr : []).map(x => x?.src).filter(x => typeof x === 'string')
    }))
  };
}
