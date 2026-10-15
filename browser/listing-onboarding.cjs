function inspectOnboarding() {
  if (location.origin !== 'https://olx-pay.olx.com.br' || location.pathname !== '/aderir')
    return { stage: 'OTHER' };
  const visible = (n) => {
    const openModal = n?.closest('[role=dialog][data-state=open]');
    if (!n || (!openModal && !n.getClientRects().length)) return false;
    for (let p = n; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (p.getAttribute('aria-hidden') === 'true' || p.matches('[role=dialog][data-state=closed]'))
        return false;
      if (s.display === 'none' || s.visibility === 'hidden' || (!openModal && s.opacity === '0'))
        return false;
    }
    return true;
  };
  const controls = [...document.querySelectorAll('button,a,[role=button]')].filter(
    (n) => visible(n) && !n.disabled,
  );
  const text = (n) => (n.innerText || n.getAttribute('aria-label') || '').trim();
  const decline = controls.filter(
    (n) =>
      /^(?:anunciar|publicar|continuar|seguir|n[aã]o quero anunciar|n[aã]o anunciar|quero anunciar).*(?:sem.*(?:garantia|olx pay)|n[aã]o.*(?:garantia|olx pay))/i.test(
        text(n),
      ) || /^(?:n[aã]o quero|dispensar).*(?:garantia|olx pay)/i.test(text(n)),
  );
  const dialogs = [...document.querySelectorAll('[role=dialog]')].filter(visible);
  const survey = dialogs.find((n) =>
    /Por que você não deseja fazer a entrega pela OLX/i.test(n.innerText),
  );
  if (survey) return { stage: 'SURVEY' };
  if (decline.length === 1) return { stage: 'DECLINE', text: text(decline[0]) };
  const shipping = [...document.querySelectorAll('input[type=checkbox]')].filter(
    (n) => visible(n) && n.getAttribute('aria-label') === 'Entrega pela OLX',
  );
  if (shipping.length === 1) return { stage: 'DELIVERY', checked: shipping[0].checked };
  const personal = [...document.querySelectorAll('input')].some(
    (n) => visible(n) && /^(?:name|birthdate\.|taxDocument\.|cpf)/.test(n.id),
  );
  if (personal) return { stage: 'IDENTITY' };
  if (
    /Evoluímos o jeito de vender/.test(document.body?.innerText || '') &&
    controls.some((n) => text(n) === 'Continuar')
  )
    return { stage: 'INTRO' };
  return { stage: 'UNKNOWN' };
}
function advanceOnboarding() {
  const state = INSPECT_ONBOARDING();
  const visible = (n) => {
    const openModal = n?.closest('[role=dialog][data-state=open]');
    if (!n || (!openModal && !n.getClientRects().length)) return false;
    for (let p = n; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (p.getAttribute('aria-hidden') === 'true' || p.matches('[role=dialog][data-state=closed]'))
        return false;
      if (s.display === 'none' || s.visibility === 'hidden' || (!openModal && s.opacity === '0'))
        return false;
    }
    return true;
  };
  const text = (n) => (n.innerText || n.getAttribute('aria-label') || '').trim();
  const clickNext = (root) => {
    const buttons = [...root.querySelectorAll('button')].filter(
      (n) =>
        visible(n) &&
        !n.disabled &&
        n.getAttribute('aria-disabled') !== 'true' &&
        text(n) === 'Continuar',
    );
    if (buttons.length !== 1) return false;
    buttons[0].click();
    return true;
  };
  if (state.stage === 'INTRO') return { progress: clickNext(document), stage: state.stage };
  if (state.stage === 'DECLINE') {
    const nodes = [...document.querySelectorAll('button,a,[role=button]')].filter(
      (n) => visible(n) && !n.disabled && text(n) === state.text,
    );
    if (nodes.length !== 1) return { progress: false, stage: state.stage };
    nodes[0].click();
    return { progress: true, stage: state.stage, guaranteeDeclined: true };
  }
  if (state.stage === 'DELIVERY') {
    const input = [...document.querySelectorAll('input[type=checkbox]')].find(
      (n) => visible(n) && n.getAttribute('aria-label') === 'Entrega pela OLX',
    );
    if (input.checked) {
      input.click();
      return { progress: true, stage: 'DISABLE_DELIVERY', shippingDisabled: !input.checked };
    }
    return { progress: clickNext(document), stage: 'DELIVERY', shippingDisabled: true };
  }
  if (state.stage === 'SURVEY') {
    const dialog = [...document.querySelectorAll('[role=dialog]')].find(
      (n) => visible(n) && /Por que você não deseja fazer a entrega pela OLX/i.test(n.innerText),
    );
    const label = [...dialog.querySelectorAll('label')].find(
      (n) => visible(n) && text(n) === 'Tenho outros motivos.',
    );
    if (!label) return { progress: false, stage: state.stage };
    const radio =
      label.control ||
      label.querySelector('input[type=radio],[role=radio]') ||
      (label.htmlFor ? document.getElementById(label.htmlFor) : null);
    if (
      !(
        radio?.checked ||
        radio?.getAttribute('aria-checked') === 'true' ||
        radio?.getAttribute('data-state') === 'checked'
      )
    ) {
      label.click();
      return { progress: true, stage: 'SURVEY_REASON' };
    }
    return { progress: clickNext(dialog), stage: state.stage };
  }
  return {
    progress: false,
    stage: state.stage,
    reason:
      state.stage === 'IDENTITY'
        ? 'A OLX exige dados pessoais. Conclua esse cadastro diretamente nesta conta.'
        : undefined,
  };
}
function onboardingScript() {
  return `(${advanceOnboarding.toString().replace('INSPECT_ONBOARDING()', `(${inspectOnboarding.toString()})()`)})()`;
}
module.exports = { inspectOnboarding, advanceOnboarding, onboardingScript };
