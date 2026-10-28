// Public DOM only. A model never receives JavaScript or selects arbitrary DOM targets.
function attributeDocument(command) {
  if (
    location.origin !== 'https://www2.olx.com.br' ||
    !/^\/(desapega|ai)(\/|$)/.test(location.pathname)
  )
    throw new Error('Página de anúncio incorreta.');
  const visible = (n) => {
    if (!n?.getClientRects().length) return false;
    for (let p = n; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    }
    return true;
  };
  const fields = [...document.querySelectorAll('[role=combobox][id]')].filter(
    (n) => visible(n) && n.getAttribute('aria-disabled') !== 'true',
  );
  if (command.action === 'category') {
    const sub = [...document.querySelectorAll('.subcategory-item[tabindex="0"]')].filter(visible);
    const cards = [...document.querySelectorAll('.card[tabindex="0"]')].filter(visible);
    const matches = (sub.length ? sub : cards).filter((n) => n.innerText.trim() === command.option);
    if (matches.length !== 1) throw new Error('Categoria ausente ou ambígua.');
    const node = matches[0];
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
    node.click();
    return true;
  }
  if (command.action === 'list')
    return fields.slice(0, 12).map((n) => ({
      id: n.id,
      label:
        [...document.querySelectorAll('label')].find((l) => l.htmlFor === n.id)?.innerText.trim() ||
        {
          audio_sound_system_type: 'Tipo',
          audio_sound_system_brand: 'Marca',
          audio_sound_system_condition: 'Condição',
          cosmetic_type: 'Tipo',
          cosmetic_brand: 'Marca',
          condition: 'Condição',
          electronics_brand: 'Marca',
          electronics_model: 'Modelo',
          electronics_condition: 'Condição',
          cellphone_storage: 'Memória interna',
          electronics_color: 'Cor',
          electronics_battery_health: 'Saúde da bateria',
        }[n.id] ||
        n.id,
      current: n.innerText.trim().slice(0, 150),
    }));
  const field = fields.find((n) => n.id === command.id);
  if (!field) throw new Error('A característica da OLX mudou.');
  const press = (node) => {
    node.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
      }),
    );
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
    node.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0 }),
    );
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    node.click();
  };
  if (command.action === 'open') {
    if (field.getAttribute('aria-expanded') !== 'true') {
      if (fields.some((n) => n !== field && n.getAttribute('aria-expanded') === 'true'))
        press(document.body);
      field.focus({ preventScroll: true });
      press(field);
    }
    return true;
  }
  const controlled = field.getAttribute('aria-controls');
  const component = field.closest('.olx-core-singleselect');
  const domVisible = (n) => {
    for (let p = n; p; p = p.parentElement)
      if (
        p.getAttribute('aria-hidden') === 'true' ||
        p.matches('[role="dialog"][data-state="closed"], [role="listbox"][data-state="closed"]') ||
        p.hidden ||
        p.style.display === 'none' ||
        p.style.visibility === 'hidden'
      )
        return false;
    return true;
  };
  const lists = [...document.querySelectorAll('[role=listbox]')].filter(domVisible);
  if (command.action === 'inspect')
    return {
      expanded: field.getAttribute('aria-expanded'),
      lists: lists.map((n) => ({ id: n.id, html: n.parentElement.outerHTML.slice(0, 1500) })),
    };
  const scope = controlled
    ? document.getElementById(controlled)
    : component
      ? field.getAttribute('aria-expanded') === 'true' && lists.length === 1
        ? lists[0]
        : null
      : document;
  const options = [...(scope?.querySelectorAll('[role=option]') || [])].filter(
    (n) => domVisible(n) && (component || visible(n)),
  );
  if (command.action === 'options')
    return [...new Set(options.map((n) => n.innerText.trim()).filter(Boolean))].slice(0, 250);
  if (command.action === 'select') {
    const match = options.filter((n) => n.innerText.trim() === command.option);
    if (match.length !== 1) throw new Error('A opção sugerida não está disponível na OLX.');
    press(match[0]);
    return true;
  }
  if (command.action === 'close') {
    if (field.getAttribute('aria-expanded') === 'true') press(document.body);
    const target = document.activeElement || field;
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
    );
    return true;
  }
  if (command.action === 'value') return field.innerText.trim();
  throw new Error('Ação de característica inválida.');
}
async function fillKnownCondition(product, io) {
  if (!product.condition) return { changes: [], pending: [] };
  const fields = (await io.dom({ action: 'list' })).filter((field) =>
    /condition|condicao/.test(
      (field.label + ' ' + field.id)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase(),
    ),
  );
  const changes = [],
    pending = [];
  for (const field of fields) {
    io.assertActive();
    if (field.current === product.condition) continue;
    await io.dom({ action: 'open', id: field.id });
    let options = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      await io.pause(150);
      options = await io.dom({ action: 'options', id: field.id });
      if (options.length) break;
    }
    if (options.includes(product.condition))
      await io.dom({ action: 'select', id: field.id, option: product.condition });
    await io.pause(200);
    await io.dom({ action: 'close', id: field.id });
    if ((await io.dom({ action: 'value', id: field.id })) !== product.condition)
      pending.push(field.label);
    else changes.push(field.label + ': ' + product.condition);
  }
  return { changes, pending };
}
async function fillAttributes(product, io) {
  const fields = await io.dom({ action: 'list' });
  const changes = [],
    pending = [],
    decisions = [];
  let compatible = fields.length > 0;
  for (const field of fields) {
    io.assertActive();
    if (
      /condi[cç][aã]o|condition/i.test(field.label + ' ' + field.id) &&
      !product.condition &&
      field.current &&
      !/Selecione/i.test(field.current)
    )
      continue;
    io.progress?.(field.label);
    await io.dom({ action: 'open', id: field.id });
    await io.pause(180);
    let options = [];
    for (let n = 0; n < 10; n++) {
      options = await io.dom({ action: 'options', id: field.id });
      if (options.length) break;
      await io.pause(150);
    }
    if (!options.length) {
      decisions.push({
        field: field.label,
        reason: 'O seletor não disponibilizou opções.',
        state: await io.dom({ action: 'inspect', id: field.id }),
      });
      await io.dom({ action: 'close', id: field.id });
      pending.push(field.label);
      continue;
    }
    let answer;
    try {
      answer = await io.choose(product, { ...field, options });
      io.assertActive();
    } catch (error) {
      await io.dom({ action: 'close', id: field.id }).catch(() => {});
      throw error;
    }
    compatible &&= answer?.compatible === true;
    decisions.push({
      field: field.label,
      options,
      current: field.current,
      option: answer?.option,
      reason: answer?.reason,
      confidence: answer?.confidence,
      compatible: answer?.compatible,
    });
    if (!answer?.option || !answer.compatible) {
      await io.dom({ action: 'close', id: field.id });
      pending.push(field.label + (answer?.reason ? ': ' + answer.reason : ''));
      continue;
    }
    // Defensive membership check, independently of the model client's validation.
    if (!options.includes(answer.option)) throw new Error('A IA escolheu uma opção inexistente.');
    await io.dom({ action: 'select', id: field.id, option: answer.option });
    await io.pause(200);
    await io.dom({ action: 'close', id: field.id });
    const value = await io.dom({ action: 'value', id: field.id });
    decisions[decisions.length - 1].observed = value;
    if (value !== answer.option) {
      pending.push(field.label);
      continue;
    }
    changes.push(field.label + ': ' + answer.option);
  }
  return { compatible, changes, pending, decisions };
}
module.exports = { attributeDocument, fillAttributes, fillKnownCondition };
