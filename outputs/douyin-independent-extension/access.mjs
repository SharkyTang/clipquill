// Serialized by chrome.scripting. Return only the kind of visible interruption,
// never form values, account details, or page text.
export function captureAccessState() {
  if (location.protocol !== 'https:' || !['www.douyin.com', 'v.douyin.com'].includes(location.hostname)) return null;
  const visible = node => {
    if (node.closest('[hidden], [aria-hidden="true"]')) return false;
    if (node.checkVisibility?.({checkOpacity: true, checkVisibilityCSS: true}) === false) return false;
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && box.width > 0 && box.height > 0;
  };
  const verificationText = /安全验证|请完成.{0,12}验证|拖动.{0,12}(滑块|拼图)|请按顺序.{0,8}点击|验证以继续|verify to continue|security verification/i;
  const loginText = /扫码登录|手机号登录|密码登录|登录后.{0,12}(观看|继续|访问)|请先登录|登录抖音|log in to continue|sign in to continue/i;
  const dialogs = [...document.querySelectorAll('[role="dialog"], dialog, [aria-modal="true"]')].filter(visible);
  const verification = [...document.querySelectorAll('[id*="captcha" i], [class*="captcha" i]')].some(visible)
    || dialogs.some(node => verificationText.test(node.textContent || ''));
  if (verification) return {type: 'verification'};
  const login = dialogs.some(node => loginText.test(node.textContent || ''))
    || [...document.querySelectorAll('[class*="login" i], [data-e2e="login-panel"]')].some(node => visible(node) && loginText.test(node.textContent || ''));
  if (login || /^\/(?:login|passport)(?:\/|$)/.test(location.pathname)) return {type: 'login'};
  return null;
}

export function accessError(state) {
  if (!['login', 'verification'].includes(state?.type)) return null;
  const error = new Error(state.type === 'login'
    ? '请在抖音页面完成登录，返回工具后点击“重试本次操作”。'
    : '请在抖音页面自行完成安全验证，返回工具后点击“重试本次操作”。');
  error.code = state.type === 'login' ? 'LOGIN_REQUIRED' : 'VERIFICATION_REQUIRED';
  return error;
}
