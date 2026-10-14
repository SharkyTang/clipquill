import {shareURL, workIdFromURL, selectMP4, filenameFor} from './core.mjs';
import {localRequest, localAudio, checkJob, completedFile} from './transcription.mjs';
import {startVideoTranscription} from './video.mjs';
import {createReview, timestamp} from './review.mjs';
import {createDraft, saveableDraft, draftText, editFullText, editBlock, draftSegments, exportDraft} from './draft.mjs';
import {migrateTerms, activeTerms} from './settings.mjs';
import {ensureLocalService} from './service.mjs';
const el = id => document.getElementById(id);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const downloads = new Map();
let pendingTabId = null, transcript = null, running = false;
let review = null, draft = null, segmentIndex = 0, audioURL = null, stopAt = null;
let lastOperation = null, retryAction = null, editRange = null, cachedAudioJob = null;
let legacyTerms = "";
function readSaved(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function persist(key,value) {
  try { localStorage.setItem(key,JSON.stringify(value)); return true; }
  catch { el("copyState").textContent = "当前稿自动保存失败，请先复制或导出，避免刷新丢失。"; return false; }
}
function status(text, state = 'waiting') { el('status').textContent = text; el('status').dataset.state = state; }
async function connectLocalService(options) {
  el('serviceStatus').textContent = '本地服务 · 正在连接';
  el('serviceStatus').dataset.state = 'waiting';
  try {
    const service = await ensureLocalService(options);
    el('serviceStatus').textContent = '本地服务 · 已连接';
    el('serviceStatus').dataset.state = 'complete';
    return service;
  } catch (error) {
    el('serviceStatus').textContent = '本地服务 · 连接未确认';
    el('serviceStatus').dataset.state = 'error';
    throw error;
  }
}
function fail(error) {
  const message = error.message || '处理失败，请重试。';
  status('未完成：' + message, 'error');
  el('retry').textContent = error.serviceStartup ? '重试启动并提取' : '重试本次操作';
  el('retry').hidden = !retryAction;
  if (Number.isInteger(error.tabId)) { pendingTabId = error.tabId; el('showPage').hidden = false; }
  if (error.serviceStartup || /服务|模型|连接|本地处理|助手|安装/.test(message)) { el('serviceHelp').hidden = false; el('serviceHelp').open = true; }
}
function busy(value) {
  running = value;
  for (const id of ['start', 'transcribe', 'current', 'refresh', 'resume', 'retry', 'loginDouyin']) el(id).disabled = value;
}
async function refreshTabs() {
  const previous = el('tabs').value;
  const tabs = await chrome.tabs.query({url: 'https://www.douyin.com/*'});
  el('tabs').replaceChildren();
  for (const tab of tabs.filter(tab => workIdFromURL(tab.url))) {
    const option = document.createElement('option'); option.value = String(tab.id);
    option.textContent = (tab.title || '抖音作品') + ' · ' + workIdFromURL(tab.url);
    el('tabs').append(option);
  }
  if (!el('tabs').options.length) {
    const option = document.createElement('option'); option.value = '';
    option.textContent = '请先打开抖音作品，或粘贴分享链接'; el('tabs').append(option);
  }
  if ([...el('tabs').options].some(o => o.value === previous)) el('tabs').value = previous;
  if (previous && previous !== el('tabs').value) resetTerms();
}
async function parserRequest(action, payload = {}) {
  const result = await chrome.runtime.sendMessage({action, ...payload});
  if (!result?.ok) {
    const error = new Error(result?.error || '扩展页面未响应，请重新加载扩展并重新打开工具页。');
    error.code = result?.code; error.tabId = result?.tabId;
    throw error;
  }
  return result;
}
async function checkDownload(id) {
  const job = downloads.get(id); if (!job) return;
  try {
    const [item] = await chrome.downloads.search({id});
    const path = completedFile(item, job.size);
    if (path) { downloads.delete(id); clearTimeout(job.timer); job.resolve(path); }
  } catch (error) { downloads.delete(id); clearTimeout(job.timer); job.reject(error); }
}
chrome.downloads.onChanged.addListener(delta => { if (downloads.has(delta.id)) checkDownload(delta.id); });
function showVideo(work, candidate) {
  el('videoEmpty').hidden = true;
  el('result').hidden = false; el('title').textContent = work.title;
  el('facts').textContent = `${work.id} · ${(work.durationMs / 1000).toFixed(1)} 秒 · ${candidate.width} × ${candidate.height} · ${(candidate.size / 1024 ** 2).toFixed(1)} MiB`;
}
async function saveVideo(work, quality = el('quality').value) {
  const candidate = selectMP4(work, work.id, Number(quality));
  showVideo(work, candidate);
  el('downloadState').textContent = `网页下载入口：${work.webpageDownloadEnabled === true ? '开启' : work.webpageDownloadEnabled === false ? '关闭' : '未知'}。播放文件的访问结果以实际下载为准。`;
  const id = await chrome.downloads.download({url: candidate.url, filename: filenameFor(work, candidate), conflictAction: 'uniquify', saveAs: false});
  status('正在保存视频，完成后会自动继续。');
  const path = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {downloads.delete(id); reject(new Error('等待下载超时，请查看 Chrome 下载列表后重试。'));}, 15 * 60 * 1000);
    downloads.set(id, {size: candidate.size, resolve, reject, timer}); checkDownload(id);
  });
  return {path, expectedBytes: candidate.size, workId: work.id, title: work.title, durationMs: work.durationMs};
}
function showTranscript(job, offline = false) {
  const oldReview = createReview(job,readSaved('review-' + job.id));
  const saved = readSaved('draft-v1-' + job.id);
  const nextDraft = createDraft(job,oldReview,saved);
  transcript = job; draft = nextDraft;
  if (draft.restoreWarning) {
    persist('draft-rejected-v1-' + job.id,saved);
    el('copyState').textContent = draft.restoreWarning;
  }
  review = draft.sources.length ? draftSegments(draft) : null; segmentIndex = 0;
  el('transcriptSection').hidden = false;
  el('emptyTranscript').hidden = true;
  el('recentState').textContent = '最近文案：' + (job.title || '上次提取的作品');
  el('reviewDetails').open = false;
  el('reviewPanel').hidden = !review;
  el('transcriptFacts').textContent = '当前稿：' + (job.title || '上次提取的作品');
  el('technicalFacts').textContent = `${job.workId} · ${job.characters} 字 · ${job.segments} 个语音片段 · 本地转写用时 ${job.elapsedSeconds.toFixed(1)} 秒 · ${job.model || '旧版模型'}`;
  el('transcriptWarnings').textContent = ['原始识别文件和旧校对草稿保留；当前稿仅保存在这台电脑的扩展中。人工确认不代表准确率。', ...(job.warnings || [])].join(' ');
  // Cache only the completed result needed by this page. No cookies or page captures.
  const resultSaved = persist('result-v1-' + job.id,job);
  const refSaved = persist('lastCompleted-v1',{id:job.id,workId:job.workId});
  el('saveState').textContent = resultSaved && refSaved ? '已保存在本机' : '保存失败 · 请导出';
  updatePreview();
  status(offline ? '已恢复本机当前稿，可编辑、复制和导出。回听时会自动连接本地助手。' : '文案已完成，可直接编辑、复制或导出。','complete');
  if (audioURL) URL.revokeObjectURL(audioURL);
  audioURL = null; cachedAudioJob = null;
  el('reviewAudio').pause(); el('reviewAudio').removeAttribute('src'); el('reviewAudio').load(); stopAt = null;
  el('playSegment').disabled = true;
  el('audioState').textContent = '展开后自动连接本地助手并加载原音。';
}
function updatePreview() {
  if (!draft) return;
  const current = exportDraft(draft);
  if (el('transcriptText').value !== current.text) el('transcriptText').value = current.text;
  el('characterCount').textContent = `${Array.from(current.text).length.toLocaleString()} 字符`;
  review = draft.sources.length ? draftSegments(draft) : null;
  el('reviewProgress').textContent = review ? `人工核对 ${current.confirmed} / ${current.total} 段` : '旧任务没有可用的逐段时间，可继续编辑、复制或导出 TXT。';
  el('mappingHint').textContent = current.srtError || 'SRT 沿用原字幕时间；跨段修改会合并原时间区间，新增文字归入所在区间，不重新估算时间。';
  if (review) {
    segmentIndex = Math.min(segmentIndex,review.length-1);
    el('segmentSelect').replaceChildren(...review.map((s,i) => {
      const option = document.createElement('option'); option.value = String(i);
      option.textContent = `${i+1}. ${s.needsAttention ? '※ ' : ''}${s.text.slice(0,42) || '（已删除文字）'}`; return option;
    }));
    renderSegment();
  }
}
function saveDraft() {
  el('saveState').textContent = '保存中…';
  const saved = persist('draft-v1-' + transcript.id,saveableDraft(draft));
  el('saveState').textContent = saved ? '已保存在本机' : '保存失败 · 请导出';
  updatePreview();
}
function renderSegment() {
  const segment = review[segmentIndex];
  el('segmentSelect').value = String(segmentIndex);
  el('segmentPosition').textContent = `${segmentIndex + 1} / ${review.length} · ${timestamp(segment.startMs).slice(3,8)}–${timestamp(segment.endMs).slice(3,8)}`;
  el('segmentText').value = segment.text;
  el('segmentOriginal').textContent = '原始识别：' + segment.original;
  el('segmentAttention').textContent = segment.needsAttention ? '建议重点回听：时间对齐不确定或两次识别有分歧。' + (segment.referenceText ? ' 对照模型片段：' + segment.referenceText + '（也可能有误）' : '') : '请结合原音核对专有名词、数字和漏字。';
  el('confirmSegment').checked = segment.confirmed;
  el('previousSegment').disabled = segmentIndex === 0;
  el('nextSegment').disabled = segmentIndex === review.length - 1;
  el('nextAttention').disabled = !review.some(s => s.needsAttention && !s.confirmed);
}
async function loadAudio(job) {
  if (cachedAudioJob === job.id && audioURL) return;
  el('reviewAudio').pause(); el('reviewAudio').removeAttribute('src'); el('reviewAudio').load(); stopAt = null;
  if (audioURL) URL.revokeObjectURL(audioURL); audioURL = null;
  el('playSegment').disabled = true;
  if (!review || !job.hasAudio) return;
  el('audioState').textContent = '正在加载本地回听音频…';
  try {
    await connectLocalService({onState: text => { el('audioState').textContent = text; }});
    const blob = await localAudio(job.id);
    if (transcript?.id !== job.id) return;
    audioURL = URL.createObjectURL(blob); cachedAudioJob = job.id; el('reviewAudio').src = audioURL;
    el('playSegment').disabled = false; el('audioState').textContent = '原音已就绪，可用播放器调整音量和播放速度。';
  } catch (error) { if (transcript?.id === job.id) el('audioState').textContent = error.message; }
}
async function followJob(ref) {
  el('resume').hidden = false;
  for (let attempt = 0; attempt < 4200; attempt++) {
    const job = checkJob(await localRequest('/jobs/' + ref.id), ref.workId);
    if (job.status === 'complete') { showTranscript(job); return; }
    if (job.status === 'failed') throw new Error(job.error || '语音识别失败。');
    const elapsed = Math.max(0, Math.round(Date.now() / 1000 - job.startedAt));
    status(`正在提取文案，已运行 ${elapsed} 秒。请保持工具页打开。`);
    await pause(2000);
  }
  throw new Error('等待识别超时，可稍后点击“恢复上次文案”查看。');
}
async function start(mode, existing = false, operation = null) {
  if (running) return;
  const terms = activeTerms(el('enableTerms').checked,el('terms').value);
  const op = operation || {mode,existing,link:el('link').value,tabId:Number(el('tabs').value),quality:el('quality').value,terms};
  lastOperation = op;
  retryAction = () => start(op.mode,op.existing,op);
  busy(true); el('retry').hidden = true; el('copyState').textContent = '';
  pendingTabId = null; el('showPage').hidden = true;
  // Existing valid output remains available until a new completed result replaces it.
  try {
    const url = op.existing ? null : shareURL(op.link);
    if (op.existing && !op.tabId) throw new Error('请先打开并选择目标抖音作品。');
    if (op.mode === 'transcribe') {
      await connectLocalService({onState: text => status(text)});
      el('serviceHelp').hidden = true;
    }
    status('正在后台读取抖音作品，请保留此工具页。');
    const {work} = await parserRequest('resolve-douyin', {url, existingTabId: op.existing ? op.tabId : null, retry: Boolean(operation)});
    if (op.mode === 'transcribe' && work.durationMs > 3600000) throw new Error('本地文案原型支持一小时以内的视频。');
    if (op.mode === 'download') {
      await saveVideo(work,op.quality);
      el('downloadState').textContent = '视频已保存到“下载 / 抖音独立导出”，文件大小已核对。';
      return status('视频已下载完成。可在下载文件夹查看。','complete');
    }
    status('正在检查已下载的视频…');
    const job = checkJob(await startVideoTranscription(work,op.quality,op.terms,{
      download:saveVideo,
      onSource:({reused,candidate}) => {
        showVideo(work,candidate);
        el('downloadState').textContent = reused ? '正在使用已下载的完整视频，无需重复下载。' : '视频已保存到“下载 / 抖音独立导出”，文件大小已核对。';
        status(reused ? '已复用本地视频，正在提取文案…' : '视频已保存，正在提取文案…');
      }
    }),work.id);
    const ref = {id:job.id,workId:work.id}; persist('lastTranscription',ref);
    resetTerms();
    await followJob(ref);
  } catch (error) { fail(error); }
  finally { busy(false); }
}
function exportTranscript(ext) {
  if (!draft) return;
  const current = exportDraft(draft);
  if (ext === 'srt' && current.srtError) { el('copyState').textContent = current.srtError; return; }
  const text = ext === 'txt' ? current.text : current.srt;
  const url = URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `${transcript.workId}_文案_当前稿.${ext}`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url),30000);
  el('copyState').textContent = `已发起 ${ext.toUpperCase()} 导出，请在浏览器下载列表查看。`;
}
function resetTerms() {
  el('enableTerms').checked = false; el('terms').disabled = true;
  el('termsState').textContent = '术语已停用。下一条任务需要重新启用。';
}
el('start').addEventListener('click', () => start('download'));
el('transcribe').addEventListener('click', () => start('transcribe'));
el('current').addEventListener('click', () => start(el('existingAction').value, true));
el('refresh').addEventListener('click', () => refreshTabs().catch(() => status('无法读取抖音页面列表。')));
el('showPage').addEventListener('click', async () => {
  if (pendingTabId === null) return;
  try { const tab = await chrome.tabs.update(pendingTabId, {active: true}); await chrome.windows.update(tab.windowId, {focused: true}); }
  catch { pendingTabId = null; el('showPage').hidden = true; status('待处理页面已关闭，请点击“重试本次操作”重新打开。','error'); }
});
el('loginTip').hidden = readSaved('loginTipSeen-v1') === true;
el('dismissLoginTip').addEventListener('click', () => { if (persist('loginTipSeen-v1',true)) el('loginTip').hidden = true; });
el('loginDouyin').addEventListener('click', async () => {
  if (running) return;
  busy(true);
  try { await parserRequest('login-douyin'); el('loginTipState').textContent = '请在抖音页面自行登录，完成后回到这里粘贴链接。'; }
  catch (error) { el('loginTipState').textContent = error.message; }
  finally { busy(false); }
});
el('exportTxt').addEventListener('click', () => exportTranscript('txt'));
el('exportSrt').addEventListener('click', () => exportTranscript('srt'));
el('copy').addEventListener('click', async () => {
  if (!transcript) return;
  try { await navigator.clipboard.writeText(draftText(draft)); el('copyState').textContent = '已复制当前文案。'; }
  catch { el('transcriptText').focus(); el('transcriptText').select(); el('copyState').textContent = '已选中全文，请按系统复制快捷键复制。'; }
});
async function restoreLast() {
  if (running) return;
  retryAction = restoreLast; el('retry').hidden = true;
  busy(true);
  try {
    const ref = JSON.parse(localStorage.getItem('lastTranscription'));
    if (!/^[a-f0-9]{32}$/.test(ref?.id || '') || !/^\d{10,30}$/.test(ref?.workId || '')) throw new Error('没有可恢复的识别任务。');
    await connectLocalService({onState: text => status(text)});
    await followJob(ref);
  } catch (error) { fail(error); }
  finally { busy(false); }
}
el('resume').addEventListener('click',restoreLast);
el('retry').addEventListener('click',() => retryAction?.());
el('resume').hidden = !readSaved('lastTranscription');
resetTerms();
try { legacyTerms = migrateTerms(localStorage); }
catch { el('termsState').textContent = '旧设置无法读取，本次仍默认不使用术语。'; }
el('importTerms').hidden = !legacyTerms;
el('importTerms').addEventListener('click',() => {
  el('terms').value = legacyTerms; el('enableTerms').checked = false; el('terms').disabled = true;
  el('termsState').textContent = '已填入旧术语，目前未启用。请检查是否适合本条视频，再勾选启用。';
});
el('enableTerms').addEventListener('change',() => {
  el('terms').disabled = !el('enableTerms').checked;
  el('termsState').textContent = el('enableTerms').checked ? '术语只用于本次提取；任务提交或换作品后自动停用。' : '本次不使用术语。';
});
el('link').addEventListener('input',resetTerms);
el('tabs').addEventListener('change',resetTerms);
el('checkConnection').addEventListener('click',async() => {
  el('checkConnection').disabled = true; el('connectionState').textContent = '正在检查…';
  try {
    await connectLocalService({onState: text => { el('connectionState').textContent = text; }});
    el('connectionState').textContent = '文案服务已就绪，可以重试提取。';
    el('serviceStatus').textContent = '本地服务 · 已连接';
    el('serviceStatus').dataset.state = 'complete';
  }
  catch(error) { el('connectionState').textContent = error.message; el('serviceStatus').textContent = '本地服务 · 连接未确认'; el('serviceStatus').dataset.state = 'error'; }
  finally { el('checkConnection').disabled = false; }
});
el('transcriptText').addEventListener('beforeinput',event => {
  const field = el('transcriptText'); editRange = {start:field.selectionStart,end:field.selectionEnd};
  if (event.inputType === 'deleteContentBackward' && editRange.start === editRange.end && editRange.start > 0) {
    const length = Array.from(field.value.slice(0,editRange.start)).at(-1).length; editRange.start -= length;
  } else if (event.inputType === 'deleteContentForward' && editRange.start === editRange.end) {
    editRange.end += Array.from(field.value.slice(editRange.end))[0]?.length || 0;
  } else if (['historyUndo','historyRedo'].includes(event.inputType)) editRange = {start:0,end:field.value.length};
});
el('transcriptText').addEventListener('input',() => {
  if (!draft) return;
  try { draft = editFullText(draft,el('transcriptText').value,editRange); stopAt = null; el('reviewAudio').pause(); saveDraft(); }
  catch(error) { el('transcriptText').value = draftText(draft); el('copyState').textContent = error.message; }
  finally { editRange = null; }
});
el('segmentText').addEventListener('input',() => {
  if (!draft || !review) return;
  draft = editBlock(draft,segmentIndex,el('segmentText').value);
  saveDraft();
});
el('confirmSegment').addEventListener('change',() => { draft.blocks[segmentIndex].confirmed = el('confirmSegment').checked; saveDraft(); });
el('reviewDetails').addEventListener('toggle',() => {
  if (el('reviewDetails').open && transcript) loadAudio(transcript);
  else { el('reviewAudio').pause(); stopAt = null; }
});
// Restore a completed draft locally even when the service is unavailable.
const completedRef = readSaved('lastCompleted-v1');
if (completedRef) {
  try { const cached = readSaved('result-v1-' + completedRef.id); if (cached) showTranscript(checkJob(cached,completedRef.workId),true); }
  catch { status('上次本机结果无法读取，可点击恢复上次文案。','error'); }
}
el('segmentSelect').addEventListener('change', () => { el('reviewAudio').pause(); stopAt = null; segmentIndex = Number(el('segmentSelect').value); renderSegment(); });
for (const [id, step] of [['previousSegment', -1], ['nextSegment', 1]]) el(id).addEventListener('click', () => {
  el('reviewAudio').pause(); stopAt = null; segmentIndex = Math.max(0, Math.min(review.length - 1, segmentIndex + step)); renderSegment();
});
el('playSegment').addEventListener('click', async () => {
  const segment = review[segmentIndex]; const player = el('reviewAudio');
  player.currentTime = Math.max(0, segment.startMs / 1000 - 0.25); stopAt = segment.endMs / 1000 + 0.25;
  try { await player.play(); el('audioState').textContent = `正在回听第 ${segmentIndex + 1} 句。`; }
  catch { el('audioState').textContent = '播放失败，请使用播放器的播放按钮重试。'; }
});
el('reviewAudio').addEventListener('timeupdate', () => { if (stopAt !== null && el('reviewAudio').currentTime >= stopAt) { el('reviewAudio').pause(); stopAt = null; } });
el('nextAttention').addEventListener('click', () => {
  for (let offset=1; offset<=review.length; offset++) {
    const index = (segmentIndex + offset) % review.length;
    if (review[index].needsAttention && !review[index].confirmed) { segmentIndex=index; el('reviewAudio').pause(); stopAt=null; renderSegment(); return; }
  }
});
refreshTabs().catch(() => status('无法读取抖音页面列表。'));

// Navigation opens existing UI; it never creates a new processing task.
el('appVersion').textContent = 'v' + chrome.runtime.getManifest().version;
function openSettings() { el('settingsPanel').open = true; el('settingsPanel').scrollIntoView({block:'nearest'}); }
el('openSettings').addEventListener('click',openSettings);
el('openServiceHelp').addEventListener('click',() => { el('serviceHelp').hidden = false; el('serviceHelp').open = true; el('serviceHelp').scrollIntoView({block:'nearest'}); });
el('recentDraft').addEventListener('click',() => {
  if (draft) { el('transcriptText').focus(); return; }
  openSettings(); el('recentState').textContent = readSaved('lastTranscription') ? '有上次识别任务，可尝试恢复。' : '还没有可恢复的最近文案。';
});
