// Public rendered composers only. Serialized into the account page, without Node.
function chatComposerDocument(context) {
  const visible = (n) =>
    n.getClientRects().length &&
    !n.closest('[aria-hidden=true]') &&
    getComputedStyle(n).visibility !== 'hidden';
  let scope;
  if (context.platform === 'facebook-marketplace') {
    if (location.origin !== 'https://www.facebook.com')
      throw Error('A página mudou. Reabra a conversa.');
    const expected = /^\/messages\/t\/(\d+)\/?$/.exec(new URL(context.url).pathname)?.[1];
    const actual = /^\/messages\/t\/(\d+)\/?$/.exec(location.pathname)?.[1];
    if (actual) {
      if (!expected || actual !== expected)
        throw Error('A conversa mudou. Volte à lista e abra novamente.');
      const mains = [...document.querySelectorAll('main,[role=main]')].filter(
        (n) => visible(n) && n.querySelector('[contenteditable=true][role=textbox],textarea'),
      );
      const leaves = mains.filter((n) => !mains.some((other) => other !== n && n.contains(other)));
      if (leaves.length === 1) scope = leaves[0];
    }
    const scopes = [];
    for (const close of !actual
      ? document.querySelectorAll('[aria-label="Fechar conversa"],[aria-label="Close chat"]')
      : []) {
      for (
        let p = close.parentElement, i = 0;
        p && i < 10 && !p.matches('body,html');
        p = p.parentElement, i++
      ) {
        if (p.querySelector('main,[role=main],header,[role=dialog][aria-label=Messenger]')) break;
        if (
          [...p.querySelectorAll('span,a')].some((n) => n.textContent.trim() === 'Marketplace') &&
          p.querySelector('[contenteditable=true]') &&
          p.innerText.includes(context.contact)
        ) {
          scopes.push(p);
          break;
        }
      }
    }
    if (scopes.length === 1) scope = scopes[0];
  } else {
    if (
      location.origin !== 'https://chat.olx.com.br' ||
      new URL(location.href).searchParams.get('chat-id') !==
        new URL(context.url).searchParams.get('chat-id')
    )
      throw Error('A conversa mudou. Volte à lista e abra novamente.');
    scope = document;
  }
  if (!scope) throw Error('Não foi possível identificar a conversa para responder.');
  const candidates = [
    ...scope.querySelectorAll('textarea,[contenteditable=true][role=textbox]'),
  ].filter(
    (n) =>
      visible(n) &&
      !n.disabled &&
      !n.readOnly &&
      !/buscar|search|pesquisar/i.test(
        (n.getAttribute('aria-label') || '') + ' ' + (n.getAttribute('placeholder') || ''),
      ),
  );
  if (candidates.length !== 1) {
    return {
      error: 'O campo de mensagem ainda não está disponível. Aguarde o chat carregar.',
      diagnostic: [
        ...scope.querySelectorAll('textarea,input,[contenteditable],[role=textbox]'),
      ].map((n) => ({
        tag: n.tagName,
        type: n.getAttribute('type'),
        role: n.getAttribute('role'),
        editable: n.getAttribute('contenteditable'),
        visible: !!visible(n),
      })),
    };
  }
  const field = candidates[0],
    value = field.value ?? field.innerText;
  if (context.phase === 'check') return { empty: !value.trim() };
  if (value.trim()) throw Error('Já existe texto no campo da conversa. Confira antes de enviar.');
  field.focus();
  field.scrollIntoView({ block: 'nearest' });
  return { focused: document.activeElement === field };
}
module.exports = { chatComposerDocument };
