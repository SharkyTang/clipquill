import {workIdFromURL} from './core.mjs';

// Observe ordinary top-level navigation; never fetch cross-origin page bodies.
export async function readNormalPage(tabId, expectedId, {getTab, capture, pause, navigate}, attempts = 40) {
  let targetId = expectedId;
  let modalURL = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const tab = await getTab(tabId);
    const currentId = workIdFromURL(tab.url);
    if (!targetId && currentId) targetId = currentId;
    if (targetId && currentId && currentId !== targetId) throw new Error('页面跳到了其他作品，已停止下载。');
    if (tab.status === 'complete' && currentId && (!modalURL || tab.url === modalURL)) {
      const work = await capture(tabId);
      // Observed normal Douyin routes differ: /video/:id omits SSR media,
      // while the same work opened as a modal includes app.videoDetail.
      // Try that ordinary page once; do not recover from an identity mismatch.
      if (work?.code === 'MISSING_WORK' && !modalURL && navigate) {
        modalURL = `https://www.douyin.com/user/self?modal_id=${targetId}`;
        await navigate(tabId, modalURL);
        await pause(800);
        continue;
      }
      if (work?.error) throw new Error(work.error);
      if (!work || work.id !== targetId) throw new Error('作品身份核对失败。');
      return work;
    }
    // Intermediate share domains need no extension permission: wait for the
    // normal page redirect to an already-authorized www.douyin.com work URL.
    await pause(800);
  }
  throw new Error('未能在正常跳转后识别原作品。请打开待处理页面，完成加载或登录后重试。');
}
