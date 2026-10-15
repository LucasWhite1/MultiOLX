// Runs in the public chat document. It only restores typing focus; it never sends messages.
function installComposerFocus() {
  if (location.origin !== 'https://chat.olx.com.br' || window.__multiolxComposerFocus) return;
  window.__multiolxComposerFocus = true;
  let pending = null;
  const selector = 'textarea,[contenteditable="true"],[role="textbox"]';
  function composer(node) {
    return (
      node instanceof HTMLElement &&
      node.matches(selector) &&
      !node.closest('[role="dialog"],dialog') &&
      !node.disabled &&
      !node.readOnly &&
      !/buscar|pesquisar/i.test(node.getAttribute('placeholder') || '') &&
      node.getClientRects().length > 0
    );
  }
  const value = (node) => (node.matches('textarea,input') ? node.value : node.textContent);
  function cancel() {
    if (!pending) return;
    pending.observer.disconnect();
    pending.timers.forEach(clearTimeout);
    pending = null;
  }
  function restore() {
    const request = pending;
    if (!request) return;
    if (location.href !== request.url || document.visibilityState !== 'visible') {
      cancel();
      return;
    }
    if (!document.hasFocus()) return;
    const active = document.activeElement;
    if (active?.matches(selector) && active !== request.node && composer(active)) {
      cancel();
      return;
    }
    const candidates = [...document.querySelectorAll(selector)].filter(composer);
    const target =
      composer(request.node) && request.node.isConnected
        ? request.node
        : candidates.length === 1
          ? candidates[0]
          : null;
    if (!target || (target === request.node && value(target)?.trim())) return;
    // A user click/Tab cancels this request. Only an emptied/replaced composer qualifies.
    if (active !== target) target.focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', cancel, true);
  document.addEventListener(
    'keydown',
    (event) => {
      cancel();
      if (
        event.key !== 'Enter' ||
        event.shiftKey ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.isComposing ||
      event.keyCode === 229 ||
        !location.search.includes('chat-id=') ||
        !composer(event.target) ||
        !value(event.target)?.trim()
      )
        return;
      const observer = new MutationObserver(restore);
      pending = { node: event.target, url: location.href, observer, timers: [] };
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['disabled', 'readonly'],
      });
      pending.timers = [0, 50, 150, 350, 800, 1500].map((ms) => setTimeout(restore, ms));
      pending.timers.push(setTimeout(cancel, 2000));
    },
    true,
  );
  window.addEventListener('pagehide', cancel);
}
module.exports = { installComposerFocus };
