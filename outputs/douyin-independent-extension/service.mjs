import {localRequest, checkService} from './transcription.mjs';

export const NATIVE_HOST = 'com.clipquill.local_helper';

function startupError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.serviceStartup = true;
  return error;
}

export async function launchLocalHelper(runtime = globalThis.chrome?.runtime, timeoutMs = 40000) {
  if (!runtime?.sendNativeMessage) {
    throw startupError('本地助手尚未安装。请运行安装包中的“首次安装.command”，完成后回来重试。', 'HELPER_NOT_INSTALLED');
  }
  let timer;
  try {
    const result = await Promise.race([
      runtime.sendNativeMessage(NATIVE_HOST, {action: 'ensureService', protocol: 1}),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(startupError('本地助手启动超时，请点击“重试启动并提取”。', 'STARTUP_TIMEOUT')), timeoutMs);
      })
    ]);
    if (result?.ok !== true || result.protocol !== 1) {
      throw startupError(result?.error || '本地助手启动失败，请重试；仍失败时重新运行首次安装。', result?.code || 'STARTUP_FAILED');
    }
    return result;
  } catch (error) {
    if (error.serviceStartup) throw error;
    if (/not found|not registered|Access to .*forbidden|specified native messaging host/i.test(error.message || '')) {
      throw startupError('本地助手尚未安装或连接配置已变化。请运行“首次安装.command”，完成后回来重试。', 'HELPER_NOT_INSTALLED');
    }
    throw startupError('本地助手未能启动。请点击重试；仍失败时重新运行“首次安装.command”修复。', 'STARTUP_FAILED');
  } finally { clearTimeout(timer); }
}

// Each attempt checks the real service again. Only an unavailable service invokes
// the host; a wrong service or an incomplete installation must not be hidden.
export async function ensureLocalService({request = localRequest, launch = launchLocalHelper, onState = () => {}} = {}) {
  onState('正在连接本地文案服务…');
  try {
    const health = await request('/health', undefined, undefined, 1500);
    checkService(health, true);
    return health;
  } catch (error) {
    if (error.code !== 'SERVICE_UNAVAILABLE') throw error;
  }
  onState('正在启动本地助手，启动后会继续提取…');
  try { await launch(); }
  catch (error) { error.serviceStartup = true; throw error; }
  onState('本地助手已启动，正在确认连接…');
  try {
    const health = await request('/health', undefined, undefined, 5000);
    checkService(health, true);
    return health;
  } catch (error) {
    error.serviceStartup = true;
    throw error;
  }
}
