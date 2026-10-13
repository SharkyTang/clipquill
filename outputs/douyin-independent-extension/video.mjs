import {mp4Candidates} from './core.mjs';
import {localRequest} from './transcription.mjs';

// Look up the actual files on every attempt, including after a page/service restart.
// CDN URLs and browser download history are not used as a cache of local files.
export async function startVideoTranscription(work, quality, terms, {download, request = localRequest, onSource = () => {}}) {
  const candidates = mp4Candidates(work, work.id, Number(quality));
  const lookup = {
    workId: work.id, durationMs: work.durationMs,
    variants: candidates.map(candidate => ({height: candidate.height, expectedBytes: candidate.size}))
  };
  async function source() {
    const result = await request('/videos/find', lookup);
    if (!result || !Object.hasOwn(result, 'file')) throw new Error('本地视频检查结果无效，请检查文案服务。');
    if (result.file === null) {
      const file = await download(work, quality);
      onSource({reused: false, candidate: candidates[0]});
      return file;
    }
    const file = result.file;
    const candidate = candidates.find(item => item.height === file.height && item.size === file.expectedBytes);
    if (!candidate || file.workId !== work.id || file.durationMs !== work.durationMs ||
        typeof file.path !== 'string' || !file.path || file.path.length > 4096 || file.path.includes('\0')) {
      throw new Error('本地视频信息与目标作品不一致，已停止。');
    }
    onSource({reused: true, candidate});
    return {path: file.path, expectedBytes: file.expectedBytes, workId: work.id, title: work.title, durationMs: work.durationMs};
  }
  const file = await source();
  try {
    return await request('/jobs', {...file, terms});
  } catch (error) {
    // A file may disappear or be truncated between lookup and submission.
    // Service/model/recognition failures never cause a fresh download.
    if (!['SOURCE_MISSING', 'SOURCE_INCOMPLETE'].includes(error.code)) throw error;
    return request('/jobs', {...await source(), terms});
  }
}
