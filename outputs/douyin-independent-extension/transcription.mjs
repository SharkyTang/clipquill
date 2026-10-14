const BASE = 'http://127.0.0.1:8766';
export async function localAudio(jobId, fetcher = fetch) {
  if (!/^[a-f0-9]{32}$/.test(jobId)) throw new Error('音频任务无效。');
  const response = await fetcher(`${BASE}/jobs/${jobId}/audio`, {credentials:'omit', cache:'no-store', redirect:'error', signal:AbortSignal.timeout(30000)});
  if (!response.ok || response.headers.get('Content-Type') !== 'audio/mp4') throw new Error('回听音频加载失败。请检查本地服务。');
  return response.blob();
}
export async function localRequest(path, payload, fetcher = fetch, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(BASE + path, {
      method: payload === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      ...(payload === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)})
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || '本地文案服务返回错误。');
      error.code = result.code;
      throw error;
    }
    return result;
  } catch (error) {
    if (error.name === 'TypeError' || error.name === 'AbortError') {
      const unavailable = new Error('无法连接本地文案服务，请重试启动。首次使用请运行“首次安装.command”。');
      unavailable.code = 'SERVICE_UNAVAILABLE';
      throw unavailable;
    }
    throw error;
  } finally { clearTimeout(timer); }
}
export function checkService(value, requireVideoReuse = false) {
  if (value?.service !== 'douyin-local-transcription' || value.protocol !== 1) throw new Error('本地端口不是匹配的文案服务。');
  if (requireVideoReuse && value.videoReuse !== true) throw new Error('本地文案服务需要更新。请关闭原服务窗口，重新运行“首次安装.command”后重试。');
  if (!value.ready) throw new Error('本地模型或音频工具未准备好，请重新运行“首次安装.command”完成安装。');
}
export function checkJob(job, expectedId) {
  if (!job || !/^[a-f0-9]{32}$/.test(job.id || '') || job.workId !== expectedId) throw new Error('转写任务与目标作品不一致。');
  if (!['running', 'complete', 'failed'].includes(job.status)) throw new Error('转写任务状态无效。');
  if (job.status === 'complete' && (typeof job.text !== 'string' || !job.text.trim() || typeof job.srt !== 'string' || !Number.isFinite(job.elapsedSeconds))) throw new Error('转写结果不完整。');
  return job;
}
export function completedFile(item, expectedBytes) {
  if (item?.state === 'interrupted') throw new Error(`下载中断（${item.error || '未知原因'}），请重试。`);
  if (item?.state !== 'complete') return null;
  const bytes = item.fileSize >= 0 ? item.fileSize : item.bytesReceived;
  if (bytes !== expectedBytes) throw new Error('下载文件大小不一致，已停止后续处理。');
  if (!item.filename) throw new Error('Chrome 未提供完整文件路径。');
  return item.filename;
}
