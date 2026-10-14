// A presentation-only record of events already observed by tool.js. This module
// never polls, persists drafts, advances a task on a timer, or starts work.
export function createTaskProgress({now = () => typeof performance === 'undefined' ? null : performance.now(), wallNow = () => Date.now()} = {}) {
  let task;
  const reset = () => {
    task = {state:'idle', taskKind:null, sourceVideoId:null, taskId:null, phases:[],
      started:null, finished:null, interrupted:false, serverStarted:null, serverFinished:null, error:null};
    return view();
  };
  const clock = () => {
    const value = now();
    return Number.isFinite(value) ? value : null;
  };
  const clean = value => typeof value === 'string' ? value.trim().slice(0,600) : '';
  const phase = key => task.phases.find(item => item.key === key);
  const running = () => task.phases.findLast(item => item.state === 'running');
  function ensure(key, label, detail = '') {
    let item = phase(key);
    if (!item) {
      item = {key, label:clean(label) || key, state:'pending', detail:clean(detail), start:null, end:null, incomplete:false};
      task.phases.push(item);
    } else {
      if (clean(label)) item.label = clean(label);
      if (clean(detail)) item.detail = clean(detail);
    }
    return item;
  }
  function close(item, state, detail = '') {
    if (!item) return;
    if (item.state === 'running') item.end = clock();
    item.state = state;
    if (clean(detail)) item.detail = clean(detail);
  }
  function begin(kind, context = {}) {
    reset();
    task.taskKind = kind === 'download' ? 'download' : 'transcript';
    task.sourceVideoId = context.sourceVideoId || context.workId || null;
    task.taskId = context.taskId || null;
    task.state = 'working';
    // A resumed task has no observed beginning in this page.
    task.started = context.restored ? null : clock();
    task.interrupted = Boolean(context.restored);
    return view();
  }
  function pending(key, label, detail = '') {
    ensure(key,label,detail);
    return view();
  }
  function enter(key, label, detail = '') {
    const item = ensure(key,label,detail);
    delete item.reused;
    if (item.state !== 'running') {
      if (item.state === 'unknown') item.incomplete = true;
      item.start = clock(); item.end = null; item.state = 'running';
    }
    task.state = 'working'; task.error = null;
    return view();
  }
  function complete(key, detail = '') {
    close(phase(key),'completed',detail);
    return view();
  }
  function reuse(key, label = '本地视频', detail = '') {
    const item = ensure(key,label,detail);
    item.state = 'skipped'; item.reused = true; item.start = null; item.end = null;
    item.detail = clean(detail) || '已复用';
    return view();
  }
  function serverTimes(job) {
    // The current bridge uses Unix seconds. elapsedSeconds belongs to the inner
    // ASR process and must not be presented as the whole download/task duration.
    const start = job.startedAt * 1000, end = job.finishedAt * 1000;
    const ceiling = wallNow() + 60000;
    if (typeof job.startedAt === 'number' && Number.isFinite(start) && start > 0 && start <= ceiling) task.serverStarted = start;
    if (typeof job.finishedAt === 'number' && Number.isFinite(end) && end > 0 && end <= ceiling &&
      task.serverStarted !== null && end >= task.serverStarted) task.serverFinished = end;
  }
  function finish(detail = '') {
    task.state = 'succeeded'; task.finished = clock(); task.error = null;
    if (clean(detail)) task.detail = clean(detail);
    return view();
  }
  function fail(error = {}) {
    const uncertain = Boolean(error.jobUncertain || error.submissionUnknown);
    task.error = clean(error.message) || (uncertain ? '任务状态待确认。' : '处理失败。');
    if (uncertain) {
      task.state = error.code === 'SERVICE_UNAVAILABLE' ? 'disconnected' : 'unknown';
      task.interrupted = true; task.finished = null;
      for (const item of task.phases.filter(item => item.state === 'running')) {
        item.state = 'unknown'; item.incomplete = true; item.end = null;
      }
    } else {
      task.state = 'failed'; task.finished = clock();
      close(running(),'failed',task.error);
    }
    return view();
  }
  function observeJob(job) {
    if (!job || (task.taskId && job.id !== task.taskId) ||
      (task.sourceVideoId && job.workId !== task.sourceVideoId)) return view();
    if (task.state === 'idle') begin('transcript',{restored:true});
    task.taskId ||= job.id || null; task.sourceVideoId ||= job.workId || null;
    serverTimes(job);
    const label = clean(job.stage).slice(0,160);
    const key = 'job:' + (label || 'processing');
    if (job.status === 'running') {
      const previous = running();
      if (previous?.key.startsWith('job:') && previous.key !== key) close(previous,'completed');
      return enter(key,label || '本地文案处理中',label ? '本地服务报告的阶段' : '服务未报告更细的处理步骤');
    }
    if (job.status === 'complete') {
      // Successful completion proves an observed running phase exited, but does
      // not create unobserved audio/alignment/review stages to fill out a list.
      for (const item of task.phases.filter(item => item.key.startsWith('job:') && ['running','unknown'].includes(item.state))) {
        if (item.state === 'unknown') item.incomplete = true;
        close(item,'completed');
      }
      const result = ensure('job:result','文案结果已返回');
      result.state = 'completed';
      return finish();
    }
    if (job.status === 'failed') {
      const previous = running();
      const coarse = !label || /^(失败|failed|error)$/i.test(label);
      if (coarse) {
        // This bridge replaces stage with “失败”; the last poll cannot prove
        // precisely where a failure occurred between two polling responses.
        if (previous?.key.startsWith('job:')) {
          previous.state = 'unknown'; previous.incomplete = true; previous.end = null;
        }
        const failure = ensure('job:failure','本地文案处理',
          '服务未报告具体失败步骤。' + (previous ? '最后观测阶段：' + previous.label + '。' : '') + (clean(job.error) || '处理失败。'));
        failure.state = 'failed';
        task.state = 'failed'; task.finished = clock(); task.error = clean(job.error) || '处理失败。';
        return view();
      }
      enter(key,label,'本地服务报告的失败阶段');
      return fail({message:job.error});
    }
    return fail({jobUncertain:true,message:'任务状态待确认：服务返回了未识别的状态。'});
  }
  function view() {
    const current = clock();
    const result = {taskKind:task.taskKind, sourceVideoId:task.sourceVideoId, taskId:task.taskId,
      state:task.state, error:task.error, detail:task.detail || '',
      phases:task.phases.map(item => {
        const value = {key:item.key,label:item.label,state:item.state,detail:item.detail};
        if (item.reused) value.reused = true;
        const end = item.state === 'running' ? current : item.end;
        if (!item.reused && !item.incomplete && item.start !== null && end !== null && end >= item.start) {
          value.elapsedMs = end - item.start; value.timingSource = 'browser'; value.timingLabel = '本页观测';
        } else if (item.incomplete) value.timingNote = '部分阶段未记录';
        return value;
      }), isTimingMeasured:false};
    const ended = ['succeeded','failed'].includes(task.state);
    if (ended && task.serverStarted !== null && task.serverFinished !== null) {
      result.totalElapsedMs = task.serverFinished - task.serverStarted;
      result.totalTimingSource = 'server'; result.totalTimingLabel = '本地服务任务用时';
      result.overallStartedAt = task.serverStarted; result.overallFinishedAt = task.serverFinished;
    } else if (ended && !task.interrupted && task.started !== null && task.finished !== null && task.finished >= task.started) {
      result.totalElapsedMs = task.finished - task.started;
      result.totalTimingSource = 'browser'; result.totalTimingLabel = '本页观测用时';
    } else if (task.state !== 'idle') result.timingNote = task.interrupted ? '耗时未知 · 部分阶段未记录' : '仅显示已观测到的阶段耗时';
    result.isTimingMeasured = result.totalElapsedMs !== undefined || result.phases.some(item => item.elapsedMs !== undefined);
    return result;
  }
  reset();
  return {begin,pending,enter,complete,reuse,observeJob,finish,fail,view,reset};
}
