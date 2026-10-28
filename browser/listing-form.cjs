// Only public form controls. No API, page state, credentials or synthetic identity.
function inspectListingForm() {
  const visible = (n) => {
    if (!n || !n.getClientRects().length) return false;
    for (let p = n; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    }
    return true;
  };
  const text = document.body?.innerText || '';
  if (location.protocol !== 'https:') return { status: 'WRONG_PAGE' };
  if (location.hostname === 'adquirir.olx.com.br' && location.pathname === '/destaques') {
    if (/Anúncio enviado com sucesso!/i.test(text)) return { status: 'SUBMITTED' };
    const free = document.querySelector('input[type=radio][aria-label="NO_PRODUCT"]');
    const finalButtons = [...document.querySelectorAll('button')];
    const final = finalButtons.filter(
      (n) => visible(n) && !n.disabled && n.innerText.trim() === 'Finalizar anúncio',
    );
    return {
      status: 'OFFERS',
      freeSelected:
        free?.checked === true &&
        ![...document.querySelectorAll('input[type=radio]')].some(
          (n) => n !== free && /^PACKAGE_/.test(n.getAttribute('aria-label') || '') && n.checked,
        ),
      canSubmit: !!free && final.length === 1,
      submitIndex: final.length === 1 ? finalButtons.indexOf(final[0]) : -1,
    };
  }
  if (location.hostname === 'olx-pay.olx.com.br' && location.pathname === '/aderir')
    return { status: 'ONBOARDING' };
  if (
    location.hostname !== 'www2.olx.com.br' ||
    !/^\/(?:desapega|ai)(?:\/|$)/.test(location.pathname)
  )
    return { status: 'WRONG_PAGE' };
  if (location.protocol !== 'https:' || !/(^|\.)olx\.com\.br$/.test(location.hostname))
    return { status: 'WRONG_PAGE' };
  if (
    /Attention Required|Just a moment/i.test(document.title) ||
    /Sorry, you have been blocked|Verify you are human/.test(
      document.querySelector('h1')?.innerText || '',
    )
  )
    return { status: 'BLOCKED' };
  const controls = [...document.querySelectorAll('input,textarea,select')].filter(
    (n) => visible(n) && !n.disabled,
  );
  const subcategories = [...document.querySelectorAll('.subcategory-item[tabindex="0"]')].filter(
    visible,
  );
  const categoryCards = [...document.querySelectorAll('.card[tabindex="0"]')].filter(visible);
  if (
    /Selecione uma categoria|Não conseguimos identificar a categoria/i.test(text) &&
    (subcategories.length || categoryCards.length)
  )
    return {
      status: 'CATEGORY',
      categoryOptions: (subcategories.length ? subcategories : categoryCards)
        .map((n) => n.innerText.trim())
        .filter(Boolean)
        .slice(0, 80),
    };
  const label = (n) =>
    [
      n.id,
      n.name,
      n.getAttribute('aria-label'),
      n.getAttribute('placeholder'),
      ...[...document.querySelectorAll('label')]
        .filter((l) => l.htmlFor === n.id && n.id)
        .map((l) => l.innerText),
    ]
      .filter(Boolean)
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const find = (pattern) =>
    controls.filter(
      (n) =>
        n.type !== 'hidden' &&
        n.type !== 'password' &&
        n.type !== 'email' &&
        pattern.test(label(n)),
    );
  const candidates = {
    title: find(/\b(title|subject|titulo)\b/),
    description: find(/\b(description|body|descricao)\b/),
    price: find(/\b(price|preco|valor)\b/),
    postalCode: find(/\b(cep|zipcode|zip_code|postalcode)\b/),
  };
  const fields = Object.fromEntries(
    Object.entries(candidates).map(([key, nodes]) => [
      key,
      nodes.length === 1 ? { id: nodes[0].id, name: nodes[0].name, tag: nodes[0].tagName } : null,
    ]),
  );
  const submit = [...document.querySelectorAll('button,input[type=submit]')].filter(
    (n) =>
      visible(n) &&
      /^(Enviar an[úu]ncio|Publicar an[úu]ncio|Publicar agora)$/i.test(
        (n.innerText || n.value || '').trim(),
      ),
  );
  const photoInput = [...document.querySelectorAll('input[type=file]')].some(
    (n) => !n.disabled && /image|\.(?:jpg|jpeg|png|gif|heic|webp)(?:\s*[, ]|$)/i.test(n.accept),
  );
  const hasTitle = Object.values(fields).some(Boolean) || photoInput;
  const next = [...document.querySelectorAll('button')].filter(
    (n) => visible(n) && /^(Continuar|Próximo|Avançar)$/i.test(n.innerText.trim()),
  );
  const nativeRequiredErrors = [...document.querySelectorAll('body *')].filter(
    (n) => visible(n) && /^Campo obrigat[óo]rio$/i.test((n.innerText || '').trim()),
  );
  return {
    status: /Preparando o seu anúncio com inteligência artificial/i.test(text)
      ? 'WAIT'
      : hasTitle || document.querySelector('[role=combobox]')
        ? 'FORM'
        : /Entre na sua conta|Entrar na OLX|Faça login/i.test(document.body?.innerText || '')
          ? 'LOGIN'
          : 'UNKNOWN',
    fields,
    photoInput,
    stage: photoInput
      ? 'photos'
      : Object.values(fields).some(Boolean)
        ? 'fields'
        : document.querySelector('[role=combobox]')
          ? 'attributes'
          : 'unknown',
    // Only public progress/error state; the file input count alone does not prove upload completion.
    photoBusy: [
      ...document.querySelectorAll(
        '[aria-busy=true],[role=progressbar],img[alt="Imagem inserida"]',
      ),
    ].some(
      (n) =>
        visible(n) &&
        !n.closest('.progress-stepped,.category-steps-navigation') &&
        (n.tagName !== 'IMG' || !n.complete || !n.naturalWidth),
    ),
    errors: [
      ...document.querySelectorAll('[role=alert],[aria-invalid=true]'),
      ...nativeRequiredErrors,
    ]
      .filter(visible)
      .map((n) => n.innerText || n.getAttribute('aria-label') || 'Campo inválido')
      .slice(0, 6),
    requiredAttributes:
      [...document.querySelectorAll('[role=combobox][aria-required=true],select[required]')].filter(
        (n) => {
          const value = n.value || n.getAttribute('aria-valuetext') || n.innerText?.trim();
          return visible(n) && (!value || /^(Selecione|Escolha)(\b|$)/i.test(value));
        },
      ).length + nativeRequiredErrors.length,
    categoryText: text.slice(0, 10000),
    canContinue: next.length === 1 && !next[0].disabled,
    continueIndex: [...document.querySelectorAll('button')].indexOf(next[0]),
    canSubmit: submit.length === 1 && !submit[0].disabled,
    submitIndex: [...document.querySelectorAll('button,input[type=submit]')].indexOf(submit[0]),
  };
}
function advanceListingForm() {
  const state = INSPECT();
  if (!state.canContinue) return false;
  const button = document.querySelectorAll('button')[state.continueIndex];
  if (!button) return false;
  button.click();
  return true;
}
function fillListingForm(payload) {
  const state = INSPECT();
  if (state.status !== 'FORM') return { ...state, filled: [] };
  const filled = [];
  for (const key of ['title', 'description', 'price', 'postalCode']) {
    const spec = state.fields[key];
    if (!spec || !payload[key]) continue;
    const nodes = [...document.querySelectorAll('input,textarea,select')].filter((n) =>
      spec.id ? n.id === spec.id : n.name === spec.name && n.tagName === spec.tag,
    );
    if (nodes.length !== 1 || nodes[0].disabled) continue;
    const node = nodes[0];
    if (node.tagName === 'SELECT') continue;
    const setter = Object.getOwnPropertyDescriptor(
      node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )?.set;
    if (!setter) continue;
    setter.call(
      node,
      key === 'price'
        ? node.type === 'number'
          ? payload[key].replace(',', '.')
          : payload[key].replace('.', ',')
        : payload[key],
    );
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    node.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    const current = spec.id ? document.getElementById(spec.id) : node;
    const actual = current?.value;
    const accepted =
      typeof actual === 'string' &&
      (key === 'price'
        ? (current.type === 'number'
            ? Number(actual)
            : Number(actual.replace(/[^\d,]/g, '').replace(',', '.'))) ===
          Number(payload[key].replace(',', '.'))
        : key === 'postalCode'
          ? actual.replace(/\D/g, '') === payload[key].replace(/\D/g, '')
          : actual === payload[key]);
    if (accepted) filled.push(key);
  }
  return { status: 'FORM', filled };
}
function attachListingPhotos(photos) {
  const state = INSPECT();
  if (state.status !== 'FORM') return { attached: false };
  const inputs = [...document.querySelectorAll('input[type=file]')].filter(
    (n) => !n.disabled && /image|\.(?:jpg|jpeg|png|gif|heic|webp)(?:\s*[, ]|$)/i.test(n.accept),
  );
  if (inputs.length !== 1 || !photos.length) return { attached: false };
  const input = inputs[0];
  if (!input.multiple && photos.length > 1) return { attached: false };
  const transfer = new DataTransfer();
  for (const photo of photos) {
    const bytes = Uint8Array.from(atob(photo.data), (c) => c.charCodeAt(0));
    transfer.items.add(new File([bytes], photo.name, { type: photo.mime }));
  }
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { attached: true, count: photos.length };
}
function submitListingForm(expected) {
  const state = INSPECT();
  if (state.status === 'OFFERS') {
    if (!state.freeSelected || !state.canSubmit)
      return {
        clicked: false,
        reason: 'Selecione Anunciar sem destacar para publicar gratuitamente.',
      };
    const button = document.querySelectorAll('button')[state.submitIndex];
    if (!button) return { clicked: false, reason: 'A etapa final mudou.' };
    button.click();
    return { clicked: true };
  }
  if (state.status !== 'FORM' || !state.canSubmit)
    return { clicked: false, reason: 'Complete os campos exigidos pela OLX antes de enviar.' };
  for (const key of ['title', 'description', 'price', 'postalCode']) {
    if (!expected[key]) continue;
    const spec = state.fields[key];
    if (!spec && expected.verifiedFields?.includes(key)) continue;
    if (!spec)
      return { clicked: false, reason: 'Não foi possível conferir todos os campos no formulário.' };
    const nodes = [...document.querySelectorAll('input,textarea')].filter((n) =>
      spec.id ? n.id === spec.id : n.name === spec.name && n.tagName === spec.tag,
    );
    if (nodes.length !== 1) return { clicked: false, reason: 'O formulário mudou.' };
    const value = nodes[0].value;
    const same =
      key === 'price'
        ? (nodes[0].type === 'number'
            ? Number(value)
            : Number(value.replace(/[^\d,]/g, '').replace(',', '.'))) ===
          Number(expected[key].replace(',', '.'))
        : key === 'postalCode'
          ? value.replace(/\D/g, '') === expected[key].replace(/\D/g, '')
          : value === expected[key];
    if (!same)
      return {
        clicked: false,
        reason:
          'O formulário foi alterado. Atualize o rascunho ou revise os dados antes de enviar.',
      };
  }
  const invalid = [
    ...document.querySelectorAll('input:invalid,textarea:invalid,select:invalid'),
  ].some((n) => n.getClientRects().length > 0);
  if (invalid)
    return { clicked: false, reason: 'Há campos obrigatórios ou inválidos no formulário da OLX.' };
  const button = document.querySelectorAll('button,input[type=submit]')[state.submitIndex];
  button.click();
  return { clicked: true };
}
function selectFreeListing() {
  const state = INSPECT();
  if (state.status !== 'OFFERS') return false;
  if (state.freeSelected) return true;
  const input = document.querySelector('input[type=radio][aria-label="NO_PRODUCT"]');
  if (!input || input.disabled) return false;
  input.click();
  return input.checked;
}
function inspectPublishedListing(expected) {
  if (
    location.origin !== 'https://conta.olx.com.br' ||
    location.pathname !== '/anuncios/publicados'
  )
    return null;
  const links = [...document.querySelectorAll('a[href]')].filter(
    (n) =>
      n.innerText.trim() === expected.title &&
      /^https:\/\/www\.olx\.com\.br\/vi\/\d+$/.test(n.href),
  );
  if (links.length !== 1) return null;
  for (let row = links[0].parentElement; row && row !== document.body; row = row.parentElement) {
    const text = row.innerText;
    const ids = new Set(
      [...row.querySelectorAll('a[href]')]
        .filter((n) => /^https:\/\/www\.olx\.com\.br\/vi\/\d+$/.test(n.href))
        .map((n) => n.href),
    );
    if (ids.size !== 1) break;
    const prices = [...text.matchAll(/R\$\s*([\d.]+,\d{2})/g)].map((m) =>
      Number(m[1].replaceAll('.', '').replace(',', '.')),
    );
    const published =
      /\bPUBLICADO\b/.test(text) ||
      row.previousElementSibling?.innerText.trim() === 'PUBLICADO' ||
      [...row.querySelectorAll('span,strong,p,div')].some(
        (n) => n.innerText.trim() === 'PUBLICADO',
      );
    if (published && prices.includes(Number(expected.price.replace(',', '.'))))
      return { url: links[0].href };
  }
  return null;
}
function script(fn, arg) {
  return `(${fn.toString().replaceAll('INSPECT()', `(${inspectListingForm.toString()})()`)})(${JSON.stringify(arg)})`;
}
module.exports = {
  inspectListingForm,
  fillListingForm,
  attachListingPhotos,
  submitListingForm,
  script,
  advanceListingForm,
  selectFreeListing,
  inspectPublishedListing,
};
