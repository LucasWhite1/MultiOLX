// Operates only on the rendered Meus anúncios page, never on private OLX APIs.
function adManagementDocument(command = {}) {
  const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const visible = (n) =>
    !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
  const label = (n) => normalize(n.getAttribute('aria-label') || n.innerText || n.title);
  const fail = (error) => ({ error });
  if (
    location.origin !== 'https://conta.olx.com.br' ||
    location.pathname !== '/anuncios/publicados'
  )
    return fail('Abra Meus anúncios nesta conta OLX; pode ser necessário entrar novamente.');
  if (command.action === 'dismiss-tour') {
    const heading = [
      ...document.querySelectorAll('h1,h2,h3,h4,p,strong,span,div,[role=heading]'),
    ].find(
      (n) => visible(n) && normalize(n.innerText) === 'Faça a entrega pela OLX, é fácil e gratuito',
    );
    if (!heading) return { dismissed: false };
    for (
      let scope = heading.parentElement;
      scope && scope !== document.body;
      scope = scope.parentElement
    ) {
      if (scope.innerText.length > 2500) break;
      const close = [...scope.querySelectorAll('button,[role=button]')].filter(
        (n) =>
          visible(n) &&
          (/^(fechar( modal| aviso)?|close|×|x)$/i.test(label(n)) ||
            /close|fechar/i.test(n.getAttribute('data-testid') || '')),
      );
      if (close.length === 1) {
        close[0].click();
        return { dismissed: true };
      }
    }
    return { dismissed: false };
  }
  const idOf = (href) => {
    try {
      const url = new URL(href, location.href);
      return url.protocol === 'https:' && /(^|\.)olx\.com\.br$/.test(url.hostname)
        ? url.pathname.match(/\/vi\/(\d+)\/?$/)?.[1] || url.pathname.match(/-(\d{8,})\/?$/)?.[1]
        : null;
    } catch {
      return null;
    }
  };
  const links = [...document.querySelectorAll('a[href]')].filter((n) => visible(n) && idOf(n.href));
  const ids = [...new Set(links.map((n) => idOf(n.href)))];
  const rows = ids
    .map((id) => {
      const candidates = links.filter((n) => idOf(n.href) === id);
      const link = candidates.find((n) => normalize(n.innerText)) || candidates[0];
      let card = link;
      for (let p = link.parentElement; p && p !== document.body; p = p.parentElement) {
        const contained = new Set(
          [...p.querySelectorAll('a[href]')].map((n) => idOf(n.href)).filter(Boolean),
        );
        if (contained.size !== 1) break;
        card = p;
        if (
          [...p.querySelectorAll('button,[role=button],a')].some(
            (n) =>
              visible(n) &&
              /^(excluir( anúncio)?|excluir permanentemente|apagar( anúncio)?)$/i.test(label(n)),
          )
        )
          break;
      }
      const title = normalize(
        link.innerText ||
          card.querySelector('h2,h3,[data-testid*=title]')?.innerText ||
          link.getAttribute('title'),
      );
      const price = normalize(card.innerText.match(/R\$\s*[\d.,]+/)?.[0]);
      const controls = [...card.querySelectorAll('button,[role=button],a')].filter(visible);
      return { id, title, price, url: link.href, card, controls };
    })
    .filter((r) => r.title);
  const nextNodes = [...document.querySelectorAll('a[href],button')].filter(
    (n) =>
      visible(n) &&
      !n.disabled &&
      n.getAttribute('aria-disabled') !== 'true' &&
      (/^(próxim[ao]( página)?|avançar|next)$/i.test(label(n)) || n.getAttribute('rel') === 'next'),
  );
  if (!command.action || command.action === 'scan') {
    const text = document.body.innerText;
    return {
      ready:
        rows.length > 0 || /nenhum anúncio|você ainda não|não encontramos anúncios/i.test(text),
      items: rows.map(({ id, title, price, url, controls }) => ({
        id,
        title,
        price,
        url,
        canDelete:
          controls.filter((n) =>
            /^(excluir( anúncio)?|excluir permanentemente|apagar( anúncio)?)$/i.test(label(n)),
          ).length === 1,
      })),
      next: nextNodes.length === 1,
      // Small, public control labels help diagnose a changed OLX layout without exporting page HTML.
      controls: [...new Set(rows.flatMap((r) => r.controls.map(label)))].slice(0, 20),
    };
  }
  if (command.action === 'next') {
    if (nextNodes.length !== 1)
      return fail('Não foi possível identificar a próxima página com segurança.');
    const next = nextNodes[0];
    if (next.tagName === 'A') {
      const url = new URL(next.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname)
        return fail('Paginação inesperada.');
    }
    next.click();
    return { clicked: true };
  }
  const row = rows.find((r) => r.id === command.id);
  if (command.action === 'open-delete') {
    if (!row || row.title !== command.title || row.price !== command.price)
      return fail('O anúncio mudou ou não está nesta página. Atualize a lista e revise novamente.');
    if ([...document.querySelectorAll('[role=dialog],dialog[open]')].some(visible))
      return fail('Feche a janela aberta na OLX e revise novamente.');
    const buttons = row.controls.filter((n) =>
      /^(excluir( anúncio)?|excluir permanentemente|apagar( anúncio)?)$/i.test(label(n)),
    );
    if (buttons.length !== 1)
      return fail('O botão Excluir não foi identificado neste anúncio. Confira pela OLX.');
    buttons[0].click();
    return { clicked: true };
  }
  if (command.action === 'confirm-delete') {
    const dialogs = [...document.querySelectorAll('[role=dialog],dialog[open]')].filter(visible);
    if (dialogs.length !== 1)
      return fail('A OLX não abriu uma confirmação reconhecida. Nenhuma confirmação foi enviada.');
    const dialog = dialogs[0];
    if (!/excluir|exclusão|apagar/i.test(dialog.innerText))
      return fail('Janela de confirmação inesperada.');
    const otherTitles = rows.filter(
      (r) => r.id !== command.id && dialog.innerText.includes(r.title),
    );
    if (otherTitles.length) return fail('A confirmação parece se referir a outro anúncio.');
    const reasons = [...dialog.querySelectorAll('select')].filter(visible);
    if (reasons.length > 1) return fail('Há mais de um motivo solicitado; confira na OLX.');
    const accepted = /^(não quero mais anunciar|outro motivo|outros motivos|outro|outros)$/i;
    if (reasons.length) {
      const select = reasons[0];
      const option = [...select.options].find(
        (n) => !n.disabled && accepted.test(normalize(n.text)),
      );
      if (!option) return fail('A OLX exige um motivo que precisa ser escolhido por você.');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      if (select.value !== option.value) {
        setter.call(select, option.value);
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { reasonSelected: true };
      }
    }
    const radios = [...dialog.querySelectorAll('input[type=radio]')];
    if (radios.length && !radios.some((n) => n.checked)) {
      const radio = radios.find((n) =>
        accepted.test(normalize(n.labels?.[0]?.innerText || n.getAttribute('aria-label'))),
      );
      if (!radio) return fail('Escolha o motivo de exclusão na OLX.');
      radio.click();
      return { reasonSelected: true };
    }
    const buttons = [...dialog.querySelectorAll('button')].filter(
      (n) =>
        visible(n) &&
        !n.disabled &&
        /^(sim,? excluir( anúncio)?|excluir( anúncio)?|confirmar( exclusão)?)$/i.test(label(n)),
    );
    if (buttons.length !== 1)
      return fail('A confirmação final não foi identificada. Confira pela OLX.');
    buttons[0].click();
    return { submitted: true };
  }
  if (command.action === 'verify-delete') {
    const dialogs = [...document.querySelectorAll('[role=dialog],dialog[open]')].filter(visible);
    const success = /anúncio (excluído|removido)( com sucesso)?|excluído com sucesso/i.test(
      document.body.innerText,
    );
    return {
      deleted: success && !row && dialogs.every((d) => !/confirmar|tem certeza/i.test(d.innerText)),
    };
  }
  return fail('Operação de anúncio inválida.');
}
module.exports = { adManagementDocument };
