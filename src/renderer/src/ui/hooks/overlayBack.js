const STACK_KEY = Symbol.for('eleckoi.ui.overlay-back');

/** A single stack shared with same-origin author frames. Only its top layer consumes Back. */
export function registerOverlayBack(handler, target = window, priority = 100) {
  let owner = target;
  try { if (target.top?.location.origin === target.location.origin) owner = target.top; } catch { /* External author documents own their navigation. */ }
  let stack = owner[STACK_KEY];
  if (!stack) {
    stack = owner[STACK_KEY] = [];
    const consume = event => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      const current = stack.reduce((top, entry) => !top || entry.priority >= top.priority ? entry : top, null);
      if (!current || current.handler(event) === false) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    owner.addEventListener('eleckoi:platform-back', consume, true);
    owner.addEventListener('keydown', consume, true);
  }
  const entry = { handler, priority };
  stack.push(entry);
  return () => {
    const index = stack.indexOf(entry);
    if (index !== -1) stack.splice(index, 1);
  };
}
