import {workIdFromURL} from './core.mjs';

// These exact hosts were observed in the target work's normal page metadata.
// Image display does not need a new extension host permission or remote service.
const imageHosts = new Set(['p3-pc-sign.douyinpic.com', 'p9-pc-sign.douyinpic.com', 'p3-pc.douyinpic.com']);

export function safeImageURL(value) {
  if (typeof value !== 'string' || !value || value.length > 8192 || /[\x00-\x20\x7f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !imageHosts.has(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

function firstImage(values) {
  if (!Array.isArray(values)) return null;
  return values.slice(0, 16).map(safeImageURL).find(Boolean) || null;
}

function label(value, limit) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, limit) : '';
}

function durationLabel(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '未知';
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function sizeLabel(bytes) {
  if (bytes === null) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

// The view adapter leaves the work, download candidate, and persisted draft alone.
// A validated CDN URL is not proof that media can currently be played; preview
// stays absent until a caller has separate, actual playback availability evidence.
export function deriveVideoInfo(work, candidate, {verifiedBytes} = {}) {
  const id = typeof work?.id === 'string' && /^\d{10,30}$/.test(work.id) ? work.id : null;
  const verifiedPage = Boolean(id && workIdFromURL(work?.pageURL) === id);
  const durationMs = Number.isFinite(work?.durationMs) && work.durationMs > 0 ? work.durationMs : null;
  const validDimension = value => Number.isSafeInteger(value) && value > 0 && value <= 99999;
  const resolutionLabel = validDimension(candidate?.width) && validDimension(candidate?.height)
    ? `${candidate.width} × ${candidate.height}` : '未知';
  const bytes = Number.isSafeInteger(candidate?.size) && candidate.size > 0 ? candidate.size : null;
  const fileVerified = bytes !== null && Number.isSafeInteger(verifiedBytes) && verifiedBytes === bytes;
  return {
    id,
    title: label(work?.title, 600) || '标题未知',
    platform: verifiedPage ? '抖音' : '未知',
    durationMs,
    durationLabel: durationLabel(durationMs),
    resolutionLabel,
    bytes,
    sizeLabel: sizeLabel(bytes),
    sizeSource: bytes === null ? null : fileVerified ? '本地文件已核对' : '页面标称',
    coverURL: verifiedPage ? firstImage(work?.coverURLs) : null,
    avatarURL: verifiedPage ? firstImage(work?.avatarURLs) : null,
    authorName: verifiedPage ? label(work?.authorName, 120) || null : null,
    previewURL: null
  };
}
