import { useLayoutEffect } from 'react';
import { isMobileProductHost } from '../../../app/services/platform.js';

/** Keep DSH's editor focus/selection, but request an IME only after an input tap. */
export function useMobileComposerKeyboard(regionRef, sessionId) {
  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!isMobileProductHost() || !region) return undefined;
    const fields = new Map();
    const restore = field => {
      const mode = fields.get(field);
      if (mode === null) field.removeAttribute('inputmode');
      else field.setAttribute('inputmode', mode);
    };
    const prepare = () => {
      for (const field of region.querySelectorAll('[data-composer-input]')) {
        if (fields.has(field)) continue;
        fields.set(field, field.getAttribute('inputmode'));
        field.setAttribute('inputmode', 'none');
      }
    };
    const requestKeyboard = event => {
      if (!event.isTrusted) return;
      const field = event.target.closest?.('[data-composer-input]');
      if (!field || !region.contains(field) || field.getAttribute('contenteditable') !== 'true') return;
      // Attachment chips are not the editable text surface.
      if (event.target.closest?.('[contenteditable="false"]')) return;
      restore(field);
    };
    const resetKeyboardRequest = event => {
      const field = event.target.closest?.('[data-composer-input]');
      if (field && fields.has(field)) field.setAttribute('inputmode', 'none');
    };
    // Parent layout runs before InputBar's passive autofocus effect.
    prepare();
    region.addEventListener('pointerdown', requestKeyboard, true);
    region.addEventListener('focusout', resetKeyboardRequest, true);
    // Slot content can mount independently after the parent has committed.
    const observer = new MutationObserver(prepare);
    observer.observe(region, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      region.removeEventListener('pointerdown', requestKeyboard, true);
      region.removeEventListener('focusout', resetKeyboardRequest, true);
      for (const field of fields.keys()) restore(field);
    };
  }, [regionRef, sessionId]);
}
