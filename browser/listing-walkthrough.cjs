// Maintenance support for observing each public OLX step before implementing it.
function snapshotDocument() {
  const visible = (n) => {
    if (!n || !n.getClientRects().length) return false;
    for (let p = n; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    }
    return true;
  };
  const posting =
    location.hostname === 'www2.olx.com.br' && /^\/(desapega|ai)(\/|$)/.test(location.pathname);
  const account =
    location.hostname === 'conta.olx.com.br' &&
    !/login|senha|password|verifica/i.test(location.pathname);
  const onboarding = location.hostname === 'olx-pay.olx.com.br' && location.pathname === '/aderir';
  const offers = location.hostname === 'adquirir.olx.com.br' && location.pathname === '/destaques';
  if (!posting && !account && !onboarding && !offers)
    return {
      origin: location.origin,
      path: location.pathname,
      title: document.title,
      protected: true,
    };
  return {
    origin: location.origin,
    path: location.pathname,
    title: document.title,
    surveyMarkup: onboarding
      ? [...document.querySelectorAll('[role=dialog]')]
          .filter((n) => /Por que você não deseja fazer a entrega/.test(n.textContent))
          .map((n) => n.outerHTML.slice(0, 16000))
      : undefined,
    text: document.body?.innerText.slice(0, 18000),
    inspection: posting ? LIVE_INSPECT() : undefined,
    adRows: account
      ? [...document.querySelectorAll('a[href]')]
          .filter((n) => /^https:\/\/www\.olx\.com\.br\/vi\/\d+$/.test(n.href))
          .map((n) => {
            let p = n.parentElement;
            const parents = [];
            for (let i = 0; i < 7 && p; i++, p = p.parentElement)
              parents.push({
                tag: p.tagName,
                cls: p.className,
                text: p.innerText.slice(0, 1000),
                previous: p.previousElementSibling?.outerHTML.slice(0, 1800),
                count: p.querySelectorAll('a[href*="/vi/"]').length,
              });
            return { title: n.innerText, href: n.href, parents };
          })
      : undefined,
    categoryControls:
      posting &&
      /Selecione uma categoria|Não conseguimos identificar/.test(document.body?.innerText || '')
        ? [
            ...document.querySelectorAll(
              '[tabindex]:not([tabindex="-1"]),[role=dialog] span,[role=dialog] li',
            ),
          ]
            .filter((n) => visible(n))
            .map((n) => ({ tag: n.tagName, html: n.outerHTML.slice(0, 2000) }))
        : undefined,
    progress: [
      ...document.querySelectorAll(
        '[aria-busy=true],[role=progressbar],[role=alert],[aria-invalid=true]',
      ),
    ]
      .filter(visible)
      .map((n) => ({
        tag: n.tagName,
        role: n.getAttribute('role'),
        label: n.getAttribute('aria-label'),
        text: n.innerText.slice(0, 300),
        html: n.outerHTML.slice(0, 1000),
        parents: [
          n.parentElement,
          n.parentElement?.parentElement,
          n.parentElement?.parentElement?.parentElement,
        ]
          .filter(Boolean)
          .map((p) => ({
            tag: p.tagName,
            cls: p.className,
            id: p.id,
            text: p.innerText.slice(0, 250),
          })),
      })),
    fields: [...document.querySelectorAll('input,textarea,select,[role=combobox]')].map((n) => ({
      tag: n.tagName,
      type: n.type,
      comboMarkup:
        posting && n.getAttribute('role') === 'combobox'
          ? n.parentElement.outerHTML.slice(0, 4000)
          : undefined,
      id: n.id,
      name: n.name,
      label: n.getAttribute('aria-label'),
      placeholder: n.getAttribute('placeholder'),
      accept: n.accept,
      multiple: n.multiple,
      visible: visible(n),
      disabled: n.disabled,
      value:
        !onboarding && !['password', 'hidden', 'file', 'email', 'tel'].includes(n.type)
          ? n.value
          : undefined,
      filled: onboarding ? !!n.value : undefined,
      checked: ['checkbox', 'radio'].includes(n.type) ? n.checked : undefined,
      options:
        n.tagName === 'SELECT'
          ? [...n.options].map((o) => ({ value: o.value, label: o.text }))
          : undefined,
    })),
    buttons: [...document.querySelectorAll('button,a,[role=button],[role=option],label')]
      .filter(visible)
      .map((n) => ({
        tag: n.tagName,
        role: n.getAttribute('role'),
        id: n.id,
        label: n.getAttribute('aria-label'),
        text: n.innerText.trim().slice(0, 300),
        disabled: n.disabled,
        href: n.tagName === 'A' ? n.getAttribute('href') : undefined,
      }))
      .filter((n) => n.text || n.label),
    images: [...document.querySelectorAll('img')]
      .filter(visible)
      .map((n) => ({ alt: n.alt, loaded: n.complete && n.naturalWidth > 0 })),
    dialogs: [...document.querySelectorAll('[role=dialog],dialog,[aria-modal=true]')]
      .filter(visible)
      .map((n) => ({
        tag: n.tagName,
        id: n.id,
        role: n.getAttribute('role'),
        text: n.innerText.slice(0, 3000),
      })),
  };
}
function actOnDocument(command) {
  const onboarding = location.hostname === 'olx-pay.olx.com.br' && location.pathname === '/aderir';
  const offers = location.hostname === 'adquirir.olx.com.br' && location.pathname === '/destaques';
  if (
    offers &&
    !(
      command.action === 'click' &&
      ['Anunciar sem destacar', 'Finalizar anúncio'].includes(command.text)
    )
  )
    throw new Error('Somente a publicação gratuita está autorizada neste fluxo.');
  if (
    location.protocol !== 'https:' ||
    (!onboarding &&
      !offers &&
      (location.hostname !== 'www2.olx.com.br' ||
        !/^\/(desapega|ai)(\/|$)/.test(location.pathname)))
  )
    throw new Error('Abra o fluxo de anúncio da OLX.');
  const visible = (n) => {
    if (!n || !n.getClientRects().length) return false;
    for (let p = n; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    }
    return true;
  };
  if (command.action === 'photos') {
    const nodes = [...document.querySelectorAll('input[type=file]')].filter(
      (n) => n.id === command.id && !n.disabled,
    );
    if (nodes.length !== 1 || !Array.isArray(command.photos) || !command.photos.length)
      throw new Error('Campo de fotos ausente ou ambíguo.');
    const transfer = new DataTransfer();
    for (const photo of command.photos)
      transfer.items.add(
        new File([Uint8Array.from(atob(photo.data), (c) => c.charCodeAt(0))], photo.name, {
          type: photo.mime,
        }),
      );
    nodes[0].files = transfer.files;
    nodes[0].dispatchEvent(new Event('input', { bubbles: true }));
    nodes[0].dispatchEvent(new Event('change', { bubbles: true }));
    return { attached: true, count: transfer.files.length };
  }
  if (command.action === 'click') {
    const nodes = [
      ...document.querySelectorAll(command.tag || 'button,a,[role=button],[role=option],label'),
    ].filter(
      (n) =>
        visible(n) &&
        !n.disabled &&
        (command.id
          ? n.id === command.id
          : command.label
            ? n.getAttribute('aria-label') === command.label
            : n.innerText.trim() === command.text),
    );
    if (nodes.length !== 1) throw new Error('Controle ausente ou ambíguo: ' + nodes.length);
    {
      nodes[0].dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }),
      );
      nodes[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      nodes[0].dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      nodes[0].dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }),
      );
    }
    nodes[0].click();
    return { clicked: true };
  }
  if (command.action === 'fill') {
    const nodes = [...document.querySelectorAll('input,textarea,select')].filter(
      (n) =>
        visible(n) &&
        !n.disabled &&
        (command.id
          ? n.id === command.id
          : command.label
            ? n.getAttribute('aria-label') === command.label
            : n.name === command.name),
    );
    if (
      nodes.length !== 1 ||
      ['password', 'email', 'tel', 'file', 'hidden'].includes(nodes[0]?.type)
    )
      throw new Error('Campo ausente, protegido ou ambíguo.');
    const n = nodes[0];
    const proto =
      n.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : n.tagName === 'SELECT'
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(n, command.value);
    n.dispatchEvent(new Event('input', { bubbles: true }));
    n.dispatchEvent(new Event('change', { bubbles: true }));
    n.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    return { filled: true };
  }
  throw new Error('Ação desconhecida.');
}
const { inspectListingForm } = require('./listing-form.cjs');
module.exports = {
  snapshotDocument: new Function(
    'return ' +
      snapshotDocument.toString().replace('LIVE_INSPECT()', `(${inspectListingForm.toString()})()`),
  )(),
  actOnDocument,
};
