import {workIdFromURL} from './core.mjs';
import {accessError} from './access.mjs';

// Observe ordinary top-level navigation; never fetch cross-origin page bodies.
export async function readNormalPage(tabId, expectedId, {getTab, capture, pause, navigate, getAccessState, resumeURL}, attempts = 40) {
  let targetId = expectedId;
  let modalURL = null;
  let resumed = false;
  let emptyReads = 0;
  const interruption = access => { const error = accessError(access); error.expectedId = targetId; return error; };
  for (let attempt = 0; attempt < attempts; attempt++) {
    const tab = await getTab(tabId);
    const currentId = workIdFromURL(tab.url);
    if (!targetId && currentId) targetId = currentId;
    if (targetId && currentId && currentId !== targetId) throw new Error('页面跳到了其他作品，已停止下载。');
    const access = tab.status === 'complete' && getAccessState ? await getAccessState(tabId, tab.url) : null;
    // A visible verification always needs the user. A login offer is only
    // blocking when the target data cannot already be read.
    if (access?.type === 'verification') throw interruption(access);
    if (tab.status === 'complete' && currentId && (!modalURL || tab.url === modalURL)) {
      const work = await capture(tabId);
      if (['MISSING_INIT', 'MISSING_WORK'].includes(work?.code) && access?.type === 'login') throw interruption(access);
      // Observed normal Douyin routes differ: /video/:id omits SSR media,
      // while the same work opened as a modal includes app.videoDetail.
      // Try that ordinary page once; do not recover from an identity mismatch.
      if (work?.code === 'MISSING_WORK' && !modalURL && navigate) {
        modalURL = `https://www.douyin.com/user/self?modal_id=${targetId}`;
        await navigate(tabId, modalURL);
        await pause(800);
        continue;
      }
      // Client-side login/verification dialogs can appear just after load.
      // Give incomplete page data a short grace period before a generic error.
      if (['MISSING_INIT', 'MISSING_WORK'].includes(work?.code) && ++emptyReads < 4) {
        await pause(800);
        continue;
      }
      if (work?.error) throw new Error(work.error);
      if (!work || work.id !== targetId) throw new Error('作品身份核对失败。');
      return work;
    }
    if (!currentId && access?.type === 'login') throw interruption(access);
    // Login may return to the homepage. Resume the original link once, after
    // the visible interruption has gone, while keeping the known work ID.
    if (tab.status === 'complete' && !currentId && !access && resumeURL && !resumed && navigate) {
      resumed = true;
      await navigate(tabId, resumeURL);
    }
    // Intermediate share domains need no extension permission: wait for the
    // normal page redirect to an already-authorized www.douyin.com work URL.
    await pause(800);
  }
  throw new Error('未能在正常跳转后识别原作品。请打开待处理页面，完成加载或登录后重试。');
}
