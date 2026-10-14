import {shareURL, workIdFromURL, selectMP4, filenameFor} from './core.mjs';
import {localRequest, localAudio, checkJob, completedFile} from './transcription.mjs';
import {startVideoTranscription} from './video.mjs';
import {createReview, timestamp} from './review.mjs';
import {createDraft, saveableDraft, draftText, draftSegments, exportDraft} from './draft.mjs';
import {migrateTerms, activeTerms} from './settings.mjs';
import {ensureLocalService} from './service.mjs';
import {createDraftEditor} from './editor.mjs';
import {deriveVideoInfo} from './metadata.mjs';
import {createTaskProgress} from './progress.mjs';
const el = id => document.getElementById(id);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const downloads = new Map();
let pendingTabId = null, transcript = null, running = false;
let review = null, draft = null, segmentIndex = 0, audioURL = null, stopAt = null;
let lastOperation = null, retryAction = null, cachedAudioJob = null, editor = null;
let operationSequence = 0, activeOperation = 0, sourceRevision = 0, editRevision = 0;
let refreshSequence = 0, audioSequence = 0, serviceSequence = 0, audioLoading = null;
let disposed = false, draftSaveFailed = false, pendingResult = null, unknownSubmission = false, unmappedText = null;
let resultCacheReady = false, completedRefReady = false, volatileTaskRef = null;
let flushComposition = null;
let legacyTerms = "";
const taskProgress = createTaskProgress();
let progressContext = null, progressOpenChoice = null, progressState = 'idle', progressAutoOpen = null;
let imageRevision = 0, cardWorkId = null, coverURL = null, avatarURL = null;
const seconds = ms => ms < 100 ? '<0.1 秒' : `${(ms / 1000).toFixed(1)} 秒`;
function renderProgress(context = progressContext) {
  if (!currentSource(context) || context !== progressContext) return;
  const view = taskProgress.view();
  const panel = el('taskProgress');
  panel.hidden = view.state === 'idle';
  panel.dataset.state = ['unknown','disconnected'].includes(view.state) ? 'unknown' : view.state;
  const labels = {working:'处理中',succeeded:view.taskKind === 'download' ? '视频已保存' : '文案已返回',failed:'未完成',unknown:'状态待确认',disconnected:'连接中断 · 待确认'};
  el('progressSummary').textContent = [labels[view.state],view.totalElapsedMs === undefined ? '' : `${view.totalTimingSource === 'server' ? '服务' : '本页'} ${seconds(view.totalElapsedMs)}`].filter(Boolean).join(' · ');
  const marks = {pending:'',running:'',completed:'✓',skipped:'–',failed:'!',unknown:'?'};
  const states = {pending:'等待',running:'进行中',completed:'已完成',skipped:'已跳过',failed:'失败',unknown:'待确认'};
  el('phaseList').replaceChildren(...view.phases.map(phase => {
    const row = document.createElement('li'); row.className = 'phase-row'; row.dataset.state = phase.state;
    const marker = document.createElement('span'); marker.className = 'phase-marker'; marker.textContent = marks[phase.state];
    marker.setAttribute?.('aria-hidden','true');
    const content = document.createElement('span'); content.className = 'phase-label'; content.textContent = phase.label;
    const detail = document.createElement('span'); detail.className = 'phase-detail';
    detail.textContent = [phase.reused ? '' : states[phase.state],phase.detail,phase.timingNote].filter(Boolean).join(' · ');
    content.append(detail);
    const time = document.createElement('span'); time.className = 'phase-time';
    time.textContent = phase.elapsedMs === undefined ? '' : seconds(phase.elapsedMs);
    row.append(marker,content,time); return row;
  }));
  el('timingNote').textContent = [view.totalElapsedMs === undefined ? view.timingNote : `${view.totalTimingLabel} ${seconds(view.totalElapsedMs)}`,
    view.phases.some(phase => phase.timingLabel === '本页观测') ? '阶段秒数为本页观测，含查询间隔；不等同引擎耗时。' : '未记录的阶段不补计时。'].filter(Boolean).join(' ');
  if (view.state !== progressState) {
    const open = ['failed','unknown','disconnected'].includes(view.state) ? true : progressOpenChoice ?? view.state === 'working';
    if (panel.open !== open) { progressAutoOpen = open; panel.open = open; }
    progressState = view.state;
  }
}
function beginProgress(kind, context, restored = false, ref = {}) {
  progressContext = context; progressOpenChoice = null; progressState = 'idle';
  taskProgress.begin(kind,{restored,sourceVideoId:ref.workId,taskId:ref.id}); renderProgress(context);
}
function progressEvent(context, action, ...args) {
  if (!currentSource(context) || context !== progressContext) return;
  taskProgress[action](...args); renderProgress(context);
}
el('taskProgress').addEventListener('toggle',event => {
  if (progressAutoOpen === el('taskProgress').open) { progressAutoOpen = null; return; }
  if (event.isTrusted) progressOpenChoice = el('taskProgress').open;
});
function resetVideo() {
  imageRevision += 1; cardWorkId = null; coverURL = null; avatarURL = null;
  for (const id of ['coverImage','authorAvatar']) { el(id).hidden = true; el(id).removeAttribute('src'); }
  el('result').hidden = true; el('videoEmpty').hidden = false; el('videoPlatform').textContent = '等待来源';
  el('downloadState').textContent = '';
}
function cardImage(id, url, context, revision) {
  const display = el(id); display.hidden = true; display.onerror = null; display.removeAttribute('src');
  const cover = id === 'coverImage';
  if (cover) { el('videoCover').dataset.state = url ? 'loading' : 'empty'; el('coverState').hidden = false; el('coverState').textContent = url ? '正在加载封面…' : '暂无可用封面'; }
  if (!url) return;
  // A separate request object makes old image events incapable of showing a
  // previous work after the visible card changes.
  const image = document.createElement('img'); image.referrerPolicy = 'no-referrer';
  const current = () => !disposed && revision === imageRevision && (!context || context.sourceRevision === sourceRevision);
  const failed = () => {
    if (!current()) return;
    display.hidden = true;
    if (cover) { el('videoCover').dataset.state = 'error'; el('coverState').hidden = false; el('coverState').textContent = '封面暂不可用'; }
  };
  image.onload = () => {
    if (!current()) return;
    display.onerror = failed;
    display.src = url; display.hidden = false;
    if (cover) { display.alt = '当前作品封面'; el('videoCover').dataset.state = 'ready'; el('coverState').hidden = true; }
  };
  image.onerror = failed;
  image.src = url;
}
function readSaved(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function readDraftRecord(key) {
  let raw = null;
  try { raw = localStorage.getItem(key); return {value:raw === null ? null : JSON.parse(raw)}; }
  catch { return {value:null,raw,warning:'已保存的当前稿无法读取，原记录未清除；当前显示可读取的识别或旧校对稿，请检查后再编辑或导出。'}; }
}
function persist(key,value) {
  try { localStorage.setItem(key,JSON.stringify(value)); return true; }
  catch { el("copyState").textContent = "当前稿自动保存失败，请先复制或导出，避免刷新丢失。"; return false; }
}
function saveStatus(text, state = 'saved') {
  el('saveState').textContent = text; el('saveState').dataset.state = state;
  el('retrySave').hidden = state !== 'error';
}
function restoreSaveStatus() {
  if (unmappedText !== null) saveStatus('修改尚未保存','warning');
  else if (draft) saveStatus(draftSaveFailed ? '保存失败 · 请导出' : '已保存在本机',draftSaveFailed ? 'error' : 'saved');
}
function status(text, state = 'waiting', announce = true) {
  if (disposed) return;
  el('status').setAttribute?.('aria-live',announce ? 'polite' : 'off');
  el('status').textContent = text; el('status').dataset.state = state;
}
const currentOperation = context => !disposed && (!context || context.id === activeOperation);
const currentSource = context => currentOperation(context) && (!context || context.sourceRevision === sourceRevision);
function assertOperation(context) { if (!currentOperation(context)) throw Object.assign(new Error('页面已离开，后台任务未被取消。'),{stale:true}); }
function operationContext() { return {id:activeOperation = ++operationSequence,sourceRevision,editRevision}; }
async function connectLocalService(options) {
  const sequence = ++serviceSequence;
  el('serviceStatus').textContent = '本地服务 · 正在连接';
  el('serviceStatus').dataset.state = 'waiting';
  try {
    const service = await ensureLocalService(options);
    if (!disposed && sequence === serviceSequence) {
      el('serviceStatus').textContent = '本地服务 · 已连接';
      el('serviceStatus').dataset.state = 'complete';
    }
    return service;
  } catch (error) {
    if (!disposed && sequence === serviceSequence) {
      el('serviceStatus').textContent = '本地服务 · 连接未确认';
      el('serviceStatus').dataset.state = 'error';
    }
    throw error;
  }
}
function fail(error) {
  if (disposed || error.stale) return;
  const message = error.message || '处理失败，请重试。';
  const uncertain = error.jobUncertain || error.submissionUnknown;
  status((uncertain ? '状态待确认：' : '未完成：') + message, uncertain ? 'unknown' : 'error');
  if (error.code === 'SERVICE_UNAVAILABLE') { el('serviceStatus').textContent = '本地服务 · 连接未确认'; el('serviceStatus').dataset.state = 'error'; }
  if (error.submissionUnknown) {
    unknownSubmission = true; retryAction = null; el('submissionNotice').hidden = false;
  }
  el('retry').textContent = error.jobUncertain ? '重新查询原任务' : error.serviceStartup ? '重试启动并提取' : '重试本次操作';
  el('retry').hidden = !retryAction;
  if (Number.isInteger(error.tabId)) { pendingTabId = error.tabId; el('showPage').hidden = false; }
  if (error.serviceStartup || /服务|模型|连接|本地处理|助手|安装/.test(message)) { el('serviceHelp').hidden = false; el('serviceHelp').open = true; }
}
function busy(value) {
  running = value;
  for (const id of ['start', 'transcribe', 'current', 'refresh', 'resume', 'retry', 'loginDouyin', 'link', 'tabs', 'existingAction', 'quality', 'enableTerms', 'terms', 'importTerms', 'checkConnection']) el(id).disabled = value;
  if (!value) el('terms').disabled = !el('enableTerms').checked;
  el('transcribe').disabled = value || Boolean(pendingResult) || unknownSubmission;
  el('applyResult').disabled = value;
}
async function refreshTabs() {
  const sequence = ++refreshSequence;
  const previous = el('tabs').value;
  const tabs = await chrome.tabs.query({url: 'https://www.douyin.com/*'});
  if (disposed || running || sequence !== refreshSequence) return;
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
const onDownloadChanged = delta => { if (downloads.has(delta.id)) checkDownload(delta.id); };
chrome.downloads.onChanged.addListener(onDownloadChanged);
function showVideo(work, candidate, context, verifiedBytes) {
  if (!currentSource(context)) return;
  const info = deriveVideoInfo(work,candidate,{verifiedBytes});
  el('videoEmpty').hidden = true;
  el('result').hidden = false; el('title').textContent = info.title; el('title').title = info.title;
  el('videoPlatform').textContent = info.platform || '未知来源';
  el('durationValue').textContent = info.durationLabel;
  el('resolutionValue').textContent = info.resolutionLabel;
  el('sizeValue').textContent = info.sizeLabel;
  el('sizeSource').textContent = `时长与分辨率：页面元数据 · 大小：${info.sizeSource || '未知'}`;
  el('videoDuration').textContent = info.durationLabel; el('videoDuration').hidden = !info.durationMs;
  el('videoAuthor').hidden = !info.authorName; el('authorName').textContent = info.authorName || '';
  if (cardWorkId !== info.id || coverURL !== info.coverURL || avatarURL !== info.avatarURL) {
    const revision = ++imageRevision; cardWorkId = info.id; coverURL = info.coverURL; avatarURL = info.avatarURL;
    cardImage('coverImage',info.coverURL,context,revision);
    cardImage('authorAvatar',info.authorName ? info.avatarURL : null,context,revision);
  }
  el('facts').textContent = `作品 ID：${info.id || '未知'}。媒体预览尚无已验证的播放路径。`;
}
async function saveVideo(work, quality = el('quality').value, context = null) {
  assertOperation(context);
  const candidate = selectMP4(work, work.id, Number(quality));
  showVideo(work, candidate, context);
  if (currentSource(context)) el('downloadState').textContent = `网页下载入口：${work.webpageDownloadEnabled === true ? '开启' : work.webpageDownloadEnabled === false ? '关闭' : '未知'}。播放文件的访问结果以实际下载为准。`;
  progressEvent(context,'enter','download','下载视频','等待 Chrome 确认文件保存及大小');
  const id = await chrome.downloads.download({url: candidate.url, filename: filenameFor(work, candidate), conflictAction: 'uniquify', saveAs: false});
  assertOperation(context);
  if (currentSource(context)) status('正在保存视频，完成后会自动继续。');
  const path = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {downloads.delete(id); reject(new Error('等待下载超时，请查看 Chrome 下载列表后重试。'));}, 15 * 60 * 1000);
    downloads.set(id, {size: candidate.size, resolve, reject, timer}); checkDownload(id);
  });
  assertOperation(context);
  progressEvent(context,'complete','download','文件已保存，实际字节数与页面标称匹配');
  showVideo(work,candidate,context,candidate.size);
  return {path, expectedBytes: candidate.size, workId: work.id, title: work.title, durationMs: work.durationMs};
}
function showTranscript(job, offline = false) {
  const oldReview = createReview(job,readSaved('review-' + job.id));
  const savedRecord = readDraftRecord('draft-v1-' + job.id);
  const saved = savedRecord.value;
  const nextDraft = createDraft(job,oldReview,saved);
  if (savedRecord.warning) nextDraft.restoreWarning = savedRecord.warning;
  transcript = job; draft = nextDraft;
  editor = createDraftEditor(draft);
  draftSaveFailed = false; unmappedText = null; editRevision += 1;
  pendingResult = null; el('pendingResultNotice').hidden = true;
  if (draft.restoreWarning) {
    persist('draft-rejected-v1-' + job.id,savedRecord.warning ? savedRecord.raw : saved);
    el('copyState').textContent = draft.restoreWarning;
  }
  review = draft.sources.length ? draftSegments(draft) : null; segmentIndex = 0;
  el('transcriptSection').hidden = false;
  el('skipEditor').hidden = false;
  el('jumpEditor').hidden = false;
  el('emptyTranscript').hidden = true;
  el('recentState').textContent = '最近文案：' + (job.title || '上次提取的作品');
  el('reviewDetails').open = false;
  el('reviewPanel').hidden = !review;
  el('transcriptFacts').textContent = '当前稿：' + (job.title || '上次提取的作品');
  el('technicalFacts').textContent = `${job.workId} · ${Number.isFinite(job.characters) ? job.characters : Array.from(job.text).length} 字 · ${Number.isFinite(job.segments) ? job.segments : draft.sources.length} 个语音片段 · 本地转写用时 ${job.elapsedSeconds.toFixed(1)} 秒 · ${job.model || '旧版模型'}`;
  el('transcriptWarnings').textContent = ['原始识别文件和旧校对草稿保留；当前稿仅保存在这台电脑的扩展中。人工确认不代表准确率。', ...(job.warnings || [])].join(' ');
  // Cache only the completed result needed by this page. No cookies or page captures.
  resultCacheReady = persist('result-v1-' + job.id,job);
  completedRefReady = resultCacheReady && persist('lastCompleted-v1',{id:job.id,workId:job.workId});
  draftSaveFailed = !(resultCacheReady && completedRefReady);
  restoreSaveStatus();
  updatePreview();
  status(offline ? '已恢复本机当前稿，可编辑、复制和导出。回听时会自动连接本地助手。' : '文案已完成，可直接编辑、复制或导出。','complete');
  audioSequence += 1; audioLoading = null;
  if (audioURL) URL.revokeObjectURL(audioURL);
  audioURL = null; cachedAudioJob = null;
  el('reviewAudio').pause(); el('reviewAudio').removeAttribute('src'); el('reviewAudio').load(); stopAt = null;
  el('reviewAudio').hidden = true;
  el('playSegment').disabled = true;
  el('audioState').textContent = job.hasAudio ? '展开后自动连接本地助手并加载原音。' : '此任务没有可用的回听音频；编辑与导出仍可使用。';
}
function receiveTranscript(job, context) {
  assertOperation(context);
  // A same-job refresh must never reload over an in-memory edited draft.
  if (transcript?.id === job.id && draft) {
    if (currentSource(context)) status('原任务已完成；保留当前编辑稿，可继续编辑和导出。','complete'); return;
  }
  if (!currentSource(context) || (draft && (draft.edited || draftSaveFailed || unmappedText !== null || editor?.composing || editRevision !== context.editRevision))) {
    pendingResult = job;
    const cached = persist('result-v1-' + job.id,job);
    el('pendingResultNotice').hidden = false;
    el('pendingResultText').textContent = '新文案已就绪：' + (job.title || job.workId) + '。当前编辑稿仍保留；载入前会再次保存当前稿。' + (cached ? '' : '新结果尚未缓存，请保持页面打开。');
    if (!cached) el('copyState').textContent = '新结果缓存失败，当前稿未被替换；请保持页面打开并及时导出。';
    if (currentSource(context)) status('新文案已就绪，等待你确认载入；当前稿未被替换。','complete'); return;
  }
  showTranscript(job);
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
  if (unmappedText !== null || editor?.composing) { restoreSaveStatus(); return false; }
  saveStatus('保存中…','pending');
  const draftSaved = persist('draft-v1-' + transcript.id,saveableDraft(draft));
  if (!resultCacheReady) resultCacheReady = persist('result-v1-' + transcript.id,transcript);
  if (resultCacheReady && !completedRefReady) completedRefReady = persist('lastCompleted-v1',{id:transcript.id,workId:transcript.workId});
  const saved = draftSaved && resultCacheReady && completedRefReady;
  draftSaveFailed = !saved;
  restoreSaveStatus();
  updatePreview();
  return saved;
}
function renderSegment() {
  const segment = review[segmentIndex];
  el('segmentSelect').value = String(segmentIndex);
  el('segmentPosition').textContent = `${segmentIndex + 1} / ${review.length} · ${timestamp(segment.startMs).split(',')[0]}–${timestamp(segment.endMs).split(',')[0]}`;
  if (el('segmentText').value !== segment.text) el('segmentText').value = segment.text;
  el('segmentOriginal').textContent = '原始识别：' + segment.original;
  el('segmentAttention').textContent = segment.needsAttention ? '建议重点回听：时间对齐不确定或两次识别有分歧。' + (segment.referenceText ? ' 对照模型片段：' + segment.referenceText + '（也可能有误）' : '') : '请结合原音核对专有名词、数字和漏字。';
  el('confirmSegment').checked = segment.confirmed;
  el('previousSegment').disabled = segmentIndex === 0;
  el('nextSegment').disabled = segmentIndex === review.length - 1;
  el('nextAttention').disabled = !review.some(s => s.needsAttention && !s.confirmed);
}
async function loadAudio(job) {
  if (!el('reviewDetails').open || !review || !job.hasAudio) return;
  if (cachedAudioJob === job.id && audioURL) { el('reviewAudio').hidden = false; el('playSegment').disabled = false; return; }
  const sequence = ++audioSequence;
  const current = () => !disposed && sequence === audioSequence && transcript?.id === job.id && el('reviewDetails').open;
  el('playSegment').disabled = true;
  el('reviewAudio').hidden = true;
  el('audioState').textContent = '正在加载本地回听音频…';
  let loading = audioLoading;
  if (!loading || loading.jobId !== job.id) {
    loading = {jobId:job.id}; audioLoading = loading;
    loading.promise = (async () => {
      try {
        await connectLocalService({onState: text => { if (current()) el('audioState').textContent = text; }});
        return await localAudio(job.id);
      } finally { if (audioLoading === loading) audioLoading = null; }
    })();
  }
  try {
    const blob = await loading.promise;
    if (!current()) return;
    if (audioURL) URL.revokeObjectURL(audioURL);
    audioURL = URL.createObjectURL(blob); cachedAudioJob = job.id; el('reviewAudio').src = audioURL; el('reviewAudio').hidden = false;
    el('playSegment').disabled = false;
    el('audioState').textContent = '原音已就绪，可用播放器调整音量和播放速度。';
  } catch (error) { if (current()) el('audioState').textContent = error.message; }
}
async function followJob(ref, context) {
  el('resume').hidden = false;
  let previousStage = '';
  for (let attempt = 0; attempt < 4200; attempt++) {
    assertOperation(context);
    let job;
    try {
      job = checkJob(await localRequest('/jobs/' + ref.id), ref.workId);
      assertOperation(context);
      if (job.id !== ref.id) throw new Error('返回的任务 ID 与原任务不一致，当前稿未被替换。');
    } catch (error) {
      if (error.stale) throw error;
      error.jobUncertain = true;
      retryAction = () => resumeKnownJob(ref);
      throw error;
    }
    progressEvent(context,'observeJob',job);
    if (job.status === 'complete') { receiveTranscript(job,context); return; }
    if (job.status === 'failed') {
      retryAction = lastOperation?.jobId === ref.id ? () => start(lastOperation.mode,lastOperation.existing,lastOperation) : null;
      throw Object.assign(new Error(job.error || '语音识别失败。'),{jobFailed:true});
    }
    const stage = typeof job.stage === 'string' && job.stage.trim() ? job.stage.slice(0,160) : '正在处理文案';
    const now = Date.now() / 1000;
    const elapsed = Number.isFinite(job.startedAt) && job.startedAt > 0 && job.startedAt <= now
      ? `，已运行 ${Math.floor(now - job.startedAt)} 秒` : '';
    if (currentSource(context)) status(`${stage}${elapsed}。请保持工具页打开。`,'waiting',stage !== previousStage);
    previousStage = stage;
    await pause(2000);
  }
  retryAction = () => resumeKnownJob(ref);
  throw Object.assign(new Error('查询超时，后台任务是否完成尚未确认；可重新查询原任务。'),{jobUncertain:true});
}
function sourceURL(text) {
  const links = [...String(text).matchAll(/https:\/\/[^\s<>"“”]+/g)].map(match => match[0].replace(/[，。；！）)]+$/, ''));
  if (new Set(links).size > 1) throw new Error('检测到多个链接，请只保留目标抖音作品的一个链接。');
  return shareURL(text);
}
async function start(mode, existing = false, operation = null) {
  if (running || disposed) return;
  if (mode === 'transcribe' && pendingResult) return status('已有新文案等待载入，请先载入或保留当前稿。','waiting');
  if (mode === 'transcribe' && unknownSubmission) return status('上次提交结果待确认，请先核对服务状态；不会自动重复提交。','unknown');
  const terms = activeTerms(el('enableTerms').checked,el('terms').value);
  const op = operation || {mode,existing,link:el('link').value,tabId:Number(el('tabs').value),quality:el('quality').value,terms};
  const context = operationContext();
  resetVideo(); beginProgress(mode,context);
  lastOperation = op;
  retryAction = () => start(op.mode,op.existing,op);
  busy(true); el('retry').hidden = true; el('copyState').textContent = '';
  if (el('existingPages').open) { el('existingPages').open = false; el('existingPages').querySelector?.('summary')?.focus(); }
  pendingTabId = null; el('showPage').hidden = true;
  try {
    progressEvent(context,'enter','source','确认视频来源');
    const url = op.existing ? null : sourceURL(op.link);
    if (op.existing && (!Number.isInteger(op.tabId) || op.tabId <= 0)) throw new Error('请先打开并选择目标抖音作品。');
    progressEvent(context,'complete','source');
    el('taskSource').hidden = false;
    el('taskSource').textContent = op.existing ? '本次来源：所选抖音作品页面' : '本次来源：' + url;
    if (op.mode === 'transcribe') {
      progressEvent(context,'enter','service','连接本地助手');
      await connectLocalService({onState: text => { if (currentSource(context)) status(text); }});
      assertOperation(context); el('serviceHelp').hidden = true;
      progressEvent(context,'complete','service');
    }
    progressEvent(context,'enter','metadata','获取视频信息');
    if (currentSource(context)) status('正在后台读取抖音作品，请保留此工具页。');
    const {work} = await parserRequest('resolve-douyin', {url, existingTabId: op.existing ? op.tabId : null, retry: Boolean(operation)});
    assertOperation(context);
    op.workId = work.id;
    const candidate = selectMP4(work,work.id,Number(op.quality));
    progressEvent(context,'complete','metadata');
    showVideo(work,candidate,context);
    if (currentSource(context)) el('taskSource').textContent = '本次作品：' + (work.title || '已选择的抖音作品');
    if (op.mode === 'transcribe' && work.durationMs > 3600000) throw new Error('本地文案原型支持一小时以内的视频。');
    if (op.mode === 'download') {
      await saveVideo(work,op.quality,context); assertOperation(context);
      progressEvent(context,'finish');
      if (currentSource(context)) {
        el('downloadState').textContent = '视频已保存到“下载 / 抖音独立导出”，文件大小已核对。';
        status('视频已下载完成。可在下载文件夹查看。','complete');
      }
      return;
    }
    if (currentSource(context)) status('正在检查已下载的视频…');
    progressEvent(context,'enter','local-file','检查本地视频');
    let submittedResponse = false;
    const request = async (path,payload) => {
      assertOperation(context);
      try {
        if (path === '/videos/find') progressEvent(context,'enter','local-file','检查本地视频');
        if (path === '/jobs') progressEvent(context,'enter','submit','提交本地文案任务');
        const value = await localRequest(path,payload); assertOperation(context);
        if (path === '/videos/find' && value?.file === null) progressEvent(context,'complete','local-file');
        if (path === '/jobs') submittedResponse = true;
        return value;
      }
      catch (error) {
        if (path === '/jobs' && ['SOURCE_MISSING','SOURCE_INCOMPLETE'].includes(error.code)) progressEvent(context,'complete','submit','原文件发生变化，服务拒绝本次提交；重新检查');
        if (path === '/jobs' && (error.code === 'SERVICE_UNAVAILABLE' || ['SyntaxError','TypeError','AbortError'].includes(error.name))) {
          error.submissionUnknown = true;
          error.message = '任务提交响应未收到，后台是否已接收尚未确认。请先核对服务；不会自动重复提取。';
        }
        throw error;
      }
    };
    let job;
    try { job = checkJob(await startVideoTranscription(work,op.quality,op.terms,{
      request,
      download:(value,quality) => saveVideo(value,quality,context),
      onSource:({reused,candidate}) => {
        if (!currentSource(context)) return;
        progressEvent(context,'complete','local-file');
        showVideo(work,candidate,context,candidate.size);
        if (reused) progressEvent(context,'reuse','download','本地视频','已复用 · 完整文件大小已核对');
        el('downloadState').textContent = reused ? '正在使用已下载的完整视频，无需重复下载。' : '视频已保存到“下载 / 抖音独立导出”，文件大小已核对。';
        status(reused ? '已复用本地视频，正在提取文案…' : '视频已保存，正在提取文案…');
      }
    }),work.id); }
    catch (error) {
      if (submittedResponse && !error.stale) { error.submissionUnknown = true; error.message = '提交响应中的任务数据无效，是否已创建任务尚未确认；不会自动重复提取。'; }
      throw error;
    }
    assertOperation(context);
    progressEvent(context,'complete','submit','本地服务已确认任务 ID');
    progressEvent(context,'observeJob',job);
    op.jobId = job.id;
    const ref = {id:job.id,workId:work.id};
    volatileTaskRef = persist('lastTranscription',ref) ? null : ref;
    if (volatileTaskRef) el('copyState').textContent = '任务引用保存失败，本页仍可重新查询；请保持页面打开并及时导出。';
    retryAction = () => resumeKnownJob(ref);
    resetTerms();
    await followJob(ref,context);
  } catch (error) { if (currentOperation(context)) { progressEvent(context,'fail',error); if (currentSource(context)) fail(error); } }
  finally { if (currentOperation(context)) busy(false); }
}
function currentOutput() {
  return unmappedText === null ? exportDraft(draft) : {text:unmappedText,srt:null,srtError:'当前输入尚未完成时间映射，请先复制或导出 TXT；SRT 暂不可用。'};
}
function exportTranscript(ext) {
  if (!draft) return;
  if (editor?.composing) { el('copyState').textContent = '正在输入，请完成当前文字后再导出。'; return; }
  const current = currentOutput();
  if (ext === 'srt' && current.srtError) { el('copyState').textContent = current.srtError; return; }
  const text = ext === 'txt' ? current.text : current.srt;
  let url;
  try {
    url = URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = `${transcript.workId}_文案_当前稿.${ext}`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url),30000);
    el('copyState').textContent = `已发起 ${ext.toUpperCase()} 导出，请在浏览器下载列表查看。`;
  } catch {
    if (url) URL.revokeObjectURL(url);
    el('copyState').textContent = `${ext.toUpperCase()} 导出未能发起，当前稿仍保留，请重试或复制全文。`;
  }
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
  if (editor?.composing) { el('copyState').textContent = '正在输入，请完成当前文字后再复制。'; return; }
  const text = currentOutput().text, jobId = transcript.id, revision = editRevision;
  try {
    await navigator.clipboard.writeText(text);
    if (!disposed && transcript?.id === jobId) el('copyState').textContent = currentOutput().text === text ? '已复制当前文案。' : '已复制点击时的文案；之后的修改尚未复制。';
  }
  catch {
    if (disposed || transcript?.id !== jobId) return;
    if (!editor?.composing && editRevision === revision && currentOutput().text === text) {
      el('transcriptText').focus(); el('transcriptText').select(); el('copyState').textContent = '已选中全文，请按系统复制快捷键复制。';
    } else el('copyState').textContent = '自动复制未成功；当前输入仍保留，请完成输入后手动选择并复制。';
  }
});
async function resumeKnownJob(ref) {
  if (running || disposed || pendingResult) return;
  const context = operationContext();
  const previousProgress = taskProgress.view();
  if (previousProgress.taskId === ref?.id && previousProgress.sourceVideoId === ref?.workId && previousProgress.state !== 'idle') {
    progressContext = context; renderProgress(context);
  } else beginProgress('transcript',context,true,ref || {});
  if (cardWorkId && cardWorkId !== ref?.workId) resetVideo();
  retryAction = () => resumeKnownJob(ref); el('retry').hidden = true;
  busy(true);
  try {
    if (!/^[a-f0-9]{32}$/.test(ref?.id || '') || !/^\d{10,30}$/.test(ref?.workId || '')) throw new Error('没有可恢复的识别任务。');
    await connectLocalService({onState: text => { if (currentSource(context)) status(text); }});
    assertOperation(context);
    if (currentSource(context)) el('serviceHelp').hidden = true;
    await followJob(ref,context);
  } catch (error) {
    if (!error.jobFailed && /^[a-f0-9]{32}$/.test(ref?.id || '')) error.jobUncertain = true;
    if (currentOperation(context)) { progressEvent(context,'fail',error); if (currentSource(context)) fail(error); }
  }
  finally { if (currentOperation(context)) busy(false); }
}
async function restoreLast() { return resumeKnownJob(volatileTaskRef || readSaved('lastTranscription')); }
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
function sourceChanged() {
  sourceRevision += 1; resetTerms();
  resetVideo(); taskProgress.reset(); progressContext = null; el('taskProgress').hidden = true;
  if (!running) {
    retryAction = null; pendingTabId = null; el('retry').hidden = true; el('showPage').hidden = true; el('taskSource').hidden = true;
    status('来源已变更，等待下载或提取。已有当前稿仍保留。');
  }
}
el('link').addEventListener('input',sourceChanged);
el('tabs').addEventListener('change',sourceChanged);
el('checkConnection').addEventListener('click',async() => {
  el('checkConnection').disabled = true; el('connectionState').textContent = '正在检查…';
  try {
    await connectLocalService({onState: text => { el('connectionState').textContent = text; }});
    el('connectionState').textContent = '文案服务已就绪，可以重试提取。';
  }
  catch(error) { el('connectionState').textContent = error.message; }
  finally { el('checkConnection').disabled = false; }
});
function editResult(result) {
  if (result.pending) { saveStatus('输入中 · 尚未保存','pending'); return; }
  if (result.changed) {
    draft = result.draft; unmappedText = null; editRevision += 1; stopAt = null; el('reviewAudio').pause(); saveDraft();
  }
  else restoreSaveStatus();
  if (result.warning) el('copyState').textContent = result.warning;
}
for (const [id,target] of [['transcriptText',() => 'full'],['segmentText',() => segmentIndex]]) {
  const field = el(id);
  const commit = (method,event) => {
    if (!editor || (id === 'segmentText' && !review)) return;
    try { editResult(editor[method](target(),field,event)); }
    catch(error) {
      unmappedText = id === 'transcriptText' ? field.value : draft.blocks.map((block,index) => index === segmentIndex ? field.value : block.text).join('\n');
      editRevision += 1; saveStatus('修改尚未保存','warning');
      el('copyState').textContent = error.message + ' 当前输入保留，可复制或导出 TXT。';
    }
  };
  field.addEventListener('beforeinput',event => editor?.beforeInput(target(),field,event));
  field.addEventListener('compositionstart',() => {
    editor?.compositionStart(target(),field); flushComposition = () => commit('compositionEnd');
  });
  field.addEventListener('compositionend',() => { commit('compositionEnd'); flushComposition = null; });
  field.addEventListener('input',event => {
    commit('input',event);
    if (editor?.composing) flushComposition = () => commit('compositionEnd');
  });
}
el('confirmSegment').addEventListener('change',() => {
  if (!draft || editor?.composing) return;
  if (unmappedText !== null) {
    el('confirmSegment').checked = draft.blocks[segmentIndex].confirmed;
    el('copyState').textContent = '当前输入尚未完成时间映射，已保留输入；请先复制或导出 TXT，暂不能更新核对记录。';
    return;
  }
  draft.blocks[segmentIndex].confirmed = el('confirmSegment').checked; editor.sync(draft); editRevision += 1; saveDraft();
});
el('retrySave').addEventListener('click',() => {
  if (!draft || editor?.composing || unmappedText !== null) return;
  if (saveDraft()) el('copyState').textContent = '当前稿已重新保存到本机。';
});
el('reviewDetails').addEventListener('toggle',() => {
  if (el('reviewDetails').open && transcript) loadAudio(transcript);
  else { audioSequence += 1; el('reviewAudio').pause(); el('playSegment').disabled = true; stopAt = null; }
});
// Restore a completed draft locally even when the service is unavailable.
const completedRef = readSaved('lastCompleted-v1');
if (completedRef) {
  try {
    const cached = readSaved('result-v1-' + completedRef.id);
    if (cached && cached.id !== completedRef.id) throw new Error('缓存任务不一致');
    if (cached) showTranscript(checkJob(cached,completedRef.workId),true);
  }
  catch { status('上次本机结果无法读取，可点击恢复上次文案。','error'); }
}
el('segmentSelect').addEventListener('change', () => {
  if (editor?.composing) { el('segmentSelect').value = String(segmentIndex); return; }
  el('reviewAudio').pause(); stopAt = null; segmentIndex = Number(el('segmentSelect').value); renderSegment();
});
for (const [id, step] of [['previousSegment', -1], ['nextSegment', 1]]) el(id).addEventListener('click', () => {
  if (editor?.composing) return;
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
  if (editor?.composing) return;
  for (let offset=1; offset<=review.length; offset++) {
    const index = (segmentIndex + offset) % review.length;
    if (review[index].needsAttention && !review[index].confirmed) { segmentIndex=index; el('reviewAudio').pause(); stopAt=null; renderSegment(); return; }
  }
});
refreshTabs().catch(() => status('无法读取抖音页面列表。'));

// Navigation opens existing UI; it never creates a new processing task.
el('appVersion').textContent = 'v' + chrome.runtime.getManifest().version;
function openSettings() { el('settingsPanel').open = true; el('settingsPanel').scrollIntoView({block:'nearest'}); el('settingsPanel').querySelector?.('summary')?.focus(); }
el('openSettings').addEventListener('click',openSettings);
el('openServiceHelp').addEventListener('click',() => { el('serviceHelp').hidden = false; el('serviceHelp').open = true; el('serviceHelp').scrollIntoView({block:'nearest'}); el('serviceHelp').querySelector?.('summary')?.focus(); });
el('recentDraft').addEventListener('click',() => {
  if (draft) { el('transcriptText').focus(); return; }
  openSettings(); el('recentState').textContent = readSaved('lastTranscription') ? '有上次识别任务，可尝试恢复。' : '还没有可恢复的最近文案。';
});
function expandSource(expanded) {
  el('sourceInput').dataset.expanded = String(expanded);
  el('expandSource').setAttribute?.('aria-expanded',String(expanded));
  el('expandSource').textContent = expanded ? '收起输入' : '展开输入';
}
el('expandSource').addEventListener('click',() => expandSource(el('sourceInput').dataset.expanded !== 'true'));
el('applyResult').addEventListener('click',() => {
  if (!pendingResult || running) return;
  if (editor?.composing || unmappedText !== null) { el('copyState').textContent = '请先完成当前文字输入，再载入新文案。'; return; }
  if (draft && !saveDraft()) { el('copyState').textContent = '当前稿保存失败，已保留当前稿和待载入结果。请先复制或导出，再重试保存。'; return; }
  showTranscript(pendingResult); busy(false);
});
el('dismissResult').addEventListener('click',() => {
  pendingResult = null; el('pendingResultNotice').hidden = true; busy(running);
  status(volatileTaskRef ? '已保留当前稿；本页仍可恢复新结果。任务引用尚未保存，请保持页面打开。' : '已保留当前稿；可尝试通过恢复上次文案查询新结果。','complete');
});
el('acknowledgeSubmission').addEventListener('click',() => {
  unknownSubmission = false; el('submissionNotice').hidden = true; busy(running);
  status('已允许手动重新提交。请确认上次任务已核对，再点击提取文案。','waiting');
});
document.addEventListener?.('keydown',event => {
  if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
  if (el('existingPages').open) {
    el('existingPages').open = false;
    el('existingPages').querySelector?.('summary')?.focus();
  } else if (el('sourceInput').dataset.expanded === 'true') {
    expandSource(false); el('expandSource').focus();
  }
});
globalThis.addEventListener?.('pagehide',event => {
  if (event.persisted) return;
  // Synchronous, best-effort final save of visible composition text. This does
  // not claim the browser guarantees a lifecycle event or that quota can heal.
  try { flushComposition?.(); if (draft && draftSaveFailed && unmappedText === null) saveDraft(); } catch { /* Current content remains available until the page leaves. */ }
  disposed = true; activeOperation = ++operationSequence; audioSequence += 1; serviceSequence += 1;
  chrome.downloads.onChanged.removeListener?.(onDownloadChanged);
  for (const job of downloads.values()) { clearTimeout(job.timer); job.reject(Object.assign(new Error('页面已离开，下载状态请在 Chrome 中查看。'),{stale:true})); }
  downloads.clear();
  if (audioURL) URL.revokeObjectURL(audioURL);
});
