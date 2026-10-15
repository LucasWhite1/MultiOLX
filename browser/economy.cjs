// Keep documents, scripts, XHR, sockets, styles, login and verification intact.
function shouldDeferResource(details, state) {
  if (!state.enabled || !state.background || !state.chatDocument) return false;
  if (!['image', 'media'].includes(details.resourceType)) return false;
  try {
    const url = new URL(details.url);
    if (
      url.hostname === 'challenges.cloudflare.com' ||
      url.hostname.endsWith('.google.com') ||
      url.hostname === 'google.com'
    )
      return false;
    const source = new URL(details.frameUrl || details.referrer || details.initiatorOrigin || '');
    return source.origin === 'https://chat.olx.com.br';
  } catch {
    return false;
  }
}
const backgroundCSS = `* { animation: none !important; transition: none !important; }
  [data-testid="advertising-placeholder"], [data-testid="web_account_banner_top"] {
    content-visibility: hidden !important;
  }`;
function restoreDeferredImages() {
  if (location.origin !== 'https://chat.olx.com.br') return 0;
  let restored = 0;
  for (const image of document.images) {
    if (!image.complete || image.naturalWidth) continue;
    const src = image.getAttribute('src');
    const srcset = image.getAttribute('srcset');
    const sources = [...(image.closest('picture')?.querySelectorAll('source[srcset]') || [])];
    for (const source of sources) {
      const value = source.getAttribute('srcset');
      source.removeAttribute('srcset');
      source.setAttribute('srcset', value);
    }
    if (srcset) {
      image.removeAttribute('srcset');
      image.setAttribute('srcset', srcset);
    }
    if (src) {
      image.removeAttribute('src');
      image.setAttribute('src', src);
    }
    restored++;
  }
  for (const media of document.querySelectorAll('video,audio')) {
    if (media.error || media.networkState === 3) media.load();
  }
  return restored;
}
module.exports = { shouldDeferResource, backgroundCSS, restoreDeferredImages };
