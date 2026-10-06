export function getDesktopService(name) {
  return globalThis.window?.dshDesktop?.[name] ?? null;
}

export function isMobileProductHost() {
  return Boolean(globalThis.window?.ElecKoiPlatform);
}

const MOBILE_WINDOW_STACK_KEY = 'eleckoi.product-window-navigation';
let navigationTimer = 0;

function mobileWindowStack() {
  const saved = window.sessionStorage.getItem(MOBILE_WINDOW_STACK_KEY);
  const stack = saved ? JSON.parse(saved) : [];
  if (!Array.isArray(stack)) throw new Error('移动页面导航记录损坏。');
  // Android's native back gesture can return without calling our JS button.
  // Remove only abandoned children, so the next nested page still returns to
  // the management page that opened it.
  while (stack.length && stack.at(-1).to !== window.location.href) stack.pop();
  return stack;
}

function navigateMobileWindow(url, { replace = false, direction = 'forward' } = {}) {
  if (navigationTimer) return;
  document.documentElement.dataset.productNavigation = direction;
  const navigate = () => {
    navigationTimer = 0;
    if (replace) window.location.replace(url);
    else window.location.assign(url);
  };
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) navigate();
  else navigationTimer = window.setTimeout(navigate, 150);
}

export function closeProductWindow() {
  if (!isMobileProductHost()) return false;
  const stack = mobileWindowStack();
  const previous = stack.pop();
  window.sessionStorage.setItem(MOBILE_WINDOW_STACK_KEY, JSON.stringify(stack));
  const main = new URL(window.location.href);
  main.searchParams.delete('view');
  main.searchParams.delete('character');
  navigateMobileWindow(previous?.from || main.toString(), { replace: true, direction: 'back' });
  return true;
}

export function openProductWindow(url, name, features) {
  if (isMobileProductHost()) {
    if (navigationTimer) return;
    const target = new URL(String(url), window.location.href).toString();
    if (target === window.location.href) return;
    const stack = mobileWindowStack();
    stack.push({ from: window.location.href, to: target });
    window.sessionStorage.setItem(MOBILE_WINDOW_STACK_KEY, JSON.stringify(stack));
    navigateMobileWindow(target);
    return;
  }
  window.open(String(url), name, features);
}
