(() => {
  if (window.ElecKoiPlatform) return;
  const pending = new Map();
  window.addEventListener('eleckoi:platform-result', event => {
    for (let index = 0; index < window.frames.length; index++)
      window.frames[index].postMessage({ type: 'eleckoi:platform-result', detail: event.detail }, window.location.origin);
    const request = pending.get(event.detail.id);
    if (!request) return;
    pending.delete(event.detail.id);
    if (event.detail.success) request.resolve({ result: event.detail.result, cancelled: event.detail.result === 'cancelled' });
    else request.reject(new Error(event.detail.result));
  });
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.type !== 'eleckoi:platform-result') return;
    window.dispatchEvent(new CustomEvent('eleckoi:platform-result', { detail: event.data.detail }));
  });
  const result = json => {
    const response = JSON.parse(json);
    if (!response.success) throw new Error(response.result);
    return response.result;
  };
  const request = operation => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    pending.set(id, { resolve, reject });
    Promise.resolve().then(() => operation(id)).catch(error => {
      pending.delete(id);
      reject(error);
    });
  });
  const encode = bytes => {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
  };
  const saveBlob = (name, blob, mime = blob.type || 'application/octet-stream') => request(async id => {
    const token = result(ElecKoiAndroid.beginFile(id, name, mime));
    try {
      const reader = blob.stream().getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (let offset = 0; offset < value.length; offset += 64 * 1024)
            result(ElecKoiAndroid.writeFile(token, encode(value.subarray(offset, offset + 64 * 1024))));
        }
      } finally { reader.releaseLock(); }
      result(ElecKoiAndroid.finishFile(token));
    } catch (error) {
      const cleanup = JSON.parse(ElecKoiAndroid.abortFile(token));
      if (!cleanup.success) throw new Error(`${error.message}; ${cleanup.result}`);
      throw error;
    }
  });
  window.ElecKoiPlatform = {
    version: 1,
    saveText: (name, text, mime = 'text/plain') => request(id => ElecKoiAndroid.saveText(id, name, mime, String(text))),
    saveBlob,
    saveBytes: (name, bytes, mime = 'application/octet-stream') => saveBlob(name, new Blob([bytes], { type: mime }), mime),
    saveUrl: async (name, url, mime) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Export HTTP ${response.status}`);
      return saveBlob(name, await response.blob(), mime);
    },
    openExternal: url => ElecKoiAndroid.openExternal(url),
    notificationSettings: () => ElecKoiAndroid.notificationSettings(),
    tts: {
      voices: () => request(id => ElecKoiAndroid.tts(id, 'voices', '{}')).then(reply => reply.result),
      synthesize: options => request(id => ElecKoiAndroid.tts(id, 'synthesize', JSON.stringify(options))).then(reply => reply.result),
      state: id => request(requestId => ElecKoiAndroid.tts(requestId, 'state', JSON.stringify({ id }))).then(reply => reply.result),
      cancel: id => request(requestId => ElecKoiAndroid.tts(requestId, 'cancel', JSON.stringify({ id }))).then(reply => reply.result),
      readAudio: (token, offset = 0, count = 65536) => result(ElecKoiAndroid.readTtsAudio(token, offset, count)),
      releaseAudio: token => result(ElecKoiAndroid.releaseTtsAudio(token))
    }
  };
  if (window === window.top) window.addEventListener('eleckoi:platform-back', event => {
    const findPopup = doc => {
      const local = [...doc.querySelectorAll('dialog.popup[open]')].at(-1);
      if (local) return local;
      for (const frame of doc.querySelectorAll('iframe')) {
        if (frame.contentDocument) {
          const popup = findPopup(frame.contentDocument);
          if (popup) return popup;
        }
      }
      return null;
    };
    const popup = findPopup(document);
    if (!popup) return;
    // ST's real cancel listener owns completion and any blocking confirmation.
    popup.dispatchEvent(new Event('cancel', { cancelable: true }));
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  // The native container consumes system-bar insets; Web styles own the content palette.
  if (window === window.top && typeof ElecKoiAndroid.appearance === 'function') {
    let lastAppearance = '';
    const updateAppearance = () => {
      const root = document.documentElement;
      const mode = root.dataset.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
      const canvas = document.createElement('canvas').getContext('2d');
      canvas.fillStyle = mode === 'dark' ? '#0d0f12' : '#f5f5f5';
      canvas.fillStyle = getComputedStyle(root).getPropertyValue('--shell-backdrop').trim() || canvas.fillStyle;
      const surface = canvas.fillStyle;
      const signature = `${mode}:${surface}`;
      if (signature === lastAppearance) return;
      lastAppearance = signature;
      ElecKoiAndroid.appearance(mode, surface);
    };
    const observer = new MutationObserver(updateAppearance);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    updateAppearance();
  }
  // Preserve download names before WebView reduces blob downloads to a URL callback.
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[download]');
    if (!anchor || !/^(blob:|data:)/.test(anchor.href)) return;
    event.preventDefault();
    window.ElecKoiPlatform.saveUrl(anchor.download || 'export', anchor.href)
      .catch(error => ElecKoiAndroid.reportError(String(error)));
  }, true);
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && /^(blob:|data:)/.test(this.href)) {
      window.ElecKoiPlatform.saveUrl(this.download || 'export', this.href)
        .catch(error => ElecKoiAndroid.reportError(String(error)));
      return;
    }
    return click.call(this);
  };
})();
