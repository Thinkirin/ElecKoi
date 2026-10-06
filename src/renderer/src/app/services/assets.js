export async function initRendererAssets() {
  return undefined;
}

export function assetSrc(src) {
  if (typeof src !== 'string') return '';
  if (globalThis.location && /^https?:$/.test(globalThis.location.protocol)) {
    if (src.startsWith('eleckoi-media://')) return '/eleckoi/media/asset?reference=' + encodeURIComponent(src);
    if (src.startsWith('file://') || src.startsWith('@files/') || src.startsWith('/eleckoi/media/android-backup/') || /^[A-Za-z]:[\\/]/.test(src) || /^\/data\/(?:data|user)\//.test(src)) return '/eleckoi/media/migrated?reference=' + encodeURIComponent(src);
  }
  return src || "";
}

globalThis.__ElecKoiResolveAsset = assetSrc;
