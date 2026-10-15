// Reads only the rendered chat list. This function is serialized into an OLX
// page without Node, IPC, authentication storage or access to page internals.
function readChatDocument() {
  if (location.origin !== 'https://chat.olx.com.br') return { status: 'AUTH_REQUIRED' };
  const heading = document.querySelector('h1')?.textContent || '';
  if (
    /Request Header Or Cookie Too Large|Sorry, you have been blocked|Verify you are human/i.test(
      heading,
    ) ||
    /Attention Required!|Just a moment/i.test(document.title)
  )
    return { status: 'BLOCKED' };
  const visible = (node) => {
    if (!node || !node.getClientRects().length) return false;
    for (let n = node; n && n !== document.body; n = n.parentElement) {
      const css = getComputedStyle(n);
      if (css.visibility === 'hidden' || css.display === 'none' || css.opacity === '0')
        return false;
    }
    return true;
  };
  // This is the public OLX bubble layout, not the site's React state/API.
  const bubbles = [...document.querySelectorAll('[class~="peer/bubble"]')].sort(
    (a, b) => a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom,
  );
  const last = bubbles.at(-1);
  let atBottom = true;
  for (let node = last?.parentElement; node && node !== document.body; node = node.parentElement) {
    if (
      node.scrollHeight > node.clientHeight + 8 &&
      /auto|scroll/.test(getComputedStyle(node).overflowY)
    ) {
      atBottom =
        getComputedStyle(node).flexDirection === 'column-reverse'
          ? Math.abs(node.scrollTop) < 80
          : node.scrollHeight - node.clientHeight - node.scrollTop < 80;
      break;
    }
  }
  const messageText = last?.querySelector('span.whitespace-pre-wrap')?.innerText.trim();
  const detail =
    location.search.includes('chat-id=') &&
    atBottom &&
    last &&
    messageText &&
    [...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')].some(
      visible,
    )
      ? {
          chatId: new URL(location.href).searchParams.get('chat-id'),
          preview: messageText,
          lastDirection:
            last.classList.contains('self-end') && last.classList.contains('items-end')
              ? 'outgoing'
              : last.classList.contains('self-start') && last.classList.contains('items-start')
                ? 'incoming'
                : 'unknown',
        }
      : null;
  const rows = [...document.querySelectorAll('a[data-testid="chat-list-item"]')];
  if (!rows.length) {
    const text = document.body?.textContent || '';
    if (
      location.search.includes('chat-id=') &&
      [...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')].some(
        (node) => node.getClientRects().length > 0,
      )
    )
      return { status: 'DETAIL', detail };
    if (text.includes('Você ainda não possui conversa ativa'))
      return { status: 'READY', conversations: [] };
    if (location.search.includes('chat-id=')) {
      const composer = [
        ...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]'),
      ].some((node) => node.getClientRects().length > 0);
      return { status: composer ? 'DETAIL' : 'OPENING' };
    }
    if (text.includes('Você ainda não possui conversa ativa'))
      return { status: 'READY', conversations: [] };
    if (/Entre na sua conta|Entrar na OLX|Faça login/i.test(text))
      return { status: 'AUTH_REQUIRED' };
    return { status: 'LOADING' };
  }
  const conversations = [];
  for (const row of rows.slice(0, 200)) {
    const title = row.querySelector('.typo-caption'),
      contact = row.querySelector('.text-2'),
      labels = row.querySelectorAll('.text-1-5');
    if (!row.id || !title || !contact || labels.length !== 2) return { status: 'LAYOUT_CHANGED' };
    const url = new URL(row.getAttribute('href'), location.origin);
    if (
      url.origin !== location.origin ||
      url.pathname !== '/' ||
      url.search !== `?chat-id=${row.id}`
    )
      return { status: 'LAYOUT_CHANGED' };
    // OLX currently renders an 8px dot, with visibility:hidden when read.
    // Do not confuse avatar initials (e.g. '4') with an unread counter.
    const dot = [...row.querySelectorAll('div')].find(
      (n) =>
        n.classList.contains('w-[8px]') &&
        n.classList.contains('h-[8px]') &&
        n.classList.contains('bg-primary-100'),
    );
    const preview = labels[0].innerText.trim();
    conversations.push({
      externalId: row.id,
      url: url.href,
      contact: contact.innerText.trim(),
      listingTitle: title.innerText.trim(),
      preview,
      timeLabel: labels[1].innerText.trim(),
      unread: dot ? visible(dot) : null,
      unreadCount: null,
      lastDirection: 'unknown',
    });
  }
  return { status: 'READY', conversations, detail };
}
function activateChatDocument(externalId) {
  if (location.origin !== 'https://chat.olx.com.br') return { clicked: false, reason: 'LOGIN' };
  const row = document.getElementById(externalId);
  if (!row || !row.matches('a[data-testid="chat-list-item"]'))
    return { clicked: false, reason: 'MISSING' };
  const url = new URL(row.getAttribute('href'), location.origin);
  if (
    url.origin !== location.origin ||
    url.pathname !== '/' ||
    url.search !== `?chat-id=${externalId}`
  )
    return { clicked: false, reason: 'INVALID' };
  row.click();
  return { clicked: true };
}
function conversationDocument() {
  const visible = (node) => !!node && node.getClientRects().length > 0;
  return {
    origin: location.origin,
    search: location.search,
    rows: document.querySelectorAll('a[data-testid="chat-list-item"]').length,
    composer: [
      ...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]'),
    ].some(visible),
    skeletons: document.querySelectorAll('.animate-pulse,[data-testid*="skeleton"]').length,
  };
}
function dismissAppPromotion() {
  const bodyText = document.body?.innerText || '';
  if (
    location.origin === 'https://chat.olx.com.br' &&
    /Evoluímos[\s\S]{0,100}negociar/.test(bodyText)
  ) {
    const heading = [...document.querySelectorAll('h1,h2,h3,p,div,span')].find(
      (node) =>
        /^Evoluímos[\s\S]{0,100}negociar/.test(node.innerText?.trim() || '') &&
        (node.innerText?.length || 0) < 200,
    );
    for (let panel = heading; panel && panel !== document.body; panel = panel.parentElement) {
      const bounds = panel.getBoundingClientRect();
      if (bounds.width >= innerWidth * 0.95) break;
      const close = [...panel.querySelectorAll('button,[role="button"]')].find((button) => {
        const rect = button.getBoundingClientRect(),
          label = button.getAttribute('aria-label') || button.getAttribute('title') || '';
        return (
          rect.width > 0 &&
          (/fechar|close|dispensar/i.test(label) ||
            (!button.innerText.trim() &&
              rect.width <= 60 &&
              rect.height <= 60 &&
              Math.abs(bounds.right - rect.right) <= 60 &&
              rect.top - bounds.top >= 0 &&
              rect.top - bounds.top < 60))
        );
      });
      if (close) {
        close.click();
        return true;
      }
    }
  }
  if (
    location.origin !== 'https://chat.olx.com.br' ||
    !/Para continuar a conversa[\s\S]{0,100}app oficial da OLX/i.test(
      document.body?.innerText || '',
    )
  )
    return false;
  const button = [...document.querySelectorAll('button,a,[role="button"],span,p')].find(
    (node) =>
      (node.innerText || node.textContent)
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('pt-BR') === 'agora não' && node.getClientRects().length > 0,
  );
  if (!button) return false;
  button.click();
  return true;
}
const messages = {
  LOADING: 'Carregando chat',
  READY: 'Chat disponível',
  AUTH_REQUIRED: 'Entre na OLX neste perfil',
  BLOCKED: 'A OLX pediu uma verificação ou recusou o acesso',
  LAYOUT_CHANGED: 'A estrutura do chat mudou; leitura interrompida',
  ERROR: 'Não foi possível ler este chat',
  CLOSED: 'Chat pausado',
  PAUSED: 'Em espera · sessão preservada',
  TIMEOUT: 'O chat não respondeu; abra o perfil para conferir',
  DETAIL: 'Conversa aberta',
  OPENING: 'Abrindo conversa',
};
function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length > 200) throw new Error('Lista de conversas inválida.');
  const ids = new Set();
  return rows.map((row) => {
    if (
      !row ||
      !['externalId', 'url', 'contact', 'listingTitle', 'preview', 'timeLabel'].every(
        (k) => typeof row[k] === 'string',
      ) ||
      !row.externalId ||
      row.externalId.length > 1024 ||
      row.contact.length > 300 ||
      row.listingTitle.length > 500 ||
      row.preview.length > 10000 ||
      row.timeLabel.length > 100
    )
      throw new Error('Conversa inválida.');
    const url = new URL(row.url);
    if (
      url.origin !== 'https://chat.olx.com.br' ||
      url.pathname !== '/' ||
      url.search !== `?chat-id=${row.externalId}` ||
      url.hash ||
      url.username ||
      url.password ||
      ids.has(row.externalId)
    )
      throw new Error('Origem ou identificador inválido.');
    ids.add(row.externalId);
    const clean = Object.fromEntries(
      ['externalId', 'url', 'contact', 'listingTitle', 'preview', 'timeLabel'].map((k) => [
        k,
        row[k],
      ]),
    );
    clean.unread = typeof row.unread === 'boolean' ? row.unread : null;
    clean.unreadCount =
      clean.unread === true &&
      Number.isInteger(row.unreadCount) &&
      row.unreadCount > 0 &&
      row.unreadCount <= 9999
        ? row.unreadCount
        : null;
    clean.lastDirection = ['incoming', 'outgoing'].includes(row.lastDirection)
      ? row.lastDirection
      : 'unknown';
    return clean;
  });
}
class UnifiedInbox {
  constructor() {
    this.accounts = new Map();
  }
  update(id, result, now = Date.now()) {
    if (!Object.hasOwn(messages, result?.status)) throw new Error('Estado de chat inválido.');
    const previous = this.accounts.get(id) || { rows: [], status: 'LOADING', observedAt: null };
    let rows = previous.rows;
    if (result.status === 'READY') {
      const old = new Map(rows.map((r) => [r.externalId, r]));
      rows = validateRows(result.conversations).map((row, order) => {
        const before = old.get(row.externalId);
        const newUnread =
          before &&
          row.unread === true &&
          (before.unread !== true || row.unreadCount !== before.unreadCount);
        const changedAt = before
          ? before.preview !== row.preview || before.timeLabel !== row.timeLabel || newUnread
            ? now
            : before.changedAt
          : previous.observedAt
            ? now
            : 0;
        const same =
          before &&
          !newUnread &&
          before.preview === row.preview &&
          before.timeLabel === row.timeLabel;
        return {
          ...row,
          order,
          changedAt,
          lastDirection:
            row.lastDirection !== 'unknown'
              ? row.lastDirection
              : same
                ? before.lastDirection
                : 'unknown',
        };
      });
    }
    const detail = result.detail;
    if (detail && ['incoming', 'outgoing'].includes(detail.lastDirection)) {
      rows = rows.map((row) => {
        // Do not associate a stale open message with a newer list preview.
        if (
          (typeof detail.chatId === 'string'
            ? new URL(row.url).searchParams.get('chat-id') !== detail.chatId
            : row.externalId !== detail.externalId) ||
          typeof detail.preview !== 'string' ||
          !(
            row.preview === detail.preview ||
            (detail.lastDirection === 'outgoing' && row.preview === `Você: ${detail.preview}`)
          )
        )
          return row;
        return {
          ...row,
          lastDirection: detail.lastDirection,
          unread: detail.viewed === true ? false : row.unread,
          unreadCount: detail.viewed === true ? null : row.unreadCount,
        };
      });
    }
    this.accounts.set(id, {
      rows,
      status: result.status,
      observedAt: result.status === 'READY' ? now : previous.observedAt,
    });
  }
  state(profiles) {
    const accounts = profiles.map((p) => {
      const entry = this.accounts.get(p.id);
      return {
        id: p.id,
        name: p.name,
        status: entry?.status || 'LOADING',
        message: messages[entry?.status || 'LOADING'],
        observedAt: entry?.observedAt || null,
        count: entry?.rows.length || 0,
      };
    });
    const conversations = accounts.flatMap((account) =>
      (this.accounts.get(account.id)?.rows || []).map((row) => ({
        ...row,
        key: `${account.id}:${row.externalId}`,
        profileId: account.id,
        profileName: account.name,
        stale: ['AUTH_REQUIRED', 'BLOCKED', 'LAYOUT_CHANGED', 'ERROR', 'TIMEOUT'].includes(
          account.status,
        ),
        paused: account.status === 'PAUSED' || account.status === 'CLOSED',
        attention:
          row.unread === true
            ? 'unread'
            : row.lastDirection === 'outgoing'
              ? 'outgoing'
              : row.unread === false && row.lastDirection === 'incoming'
                ? 'awaiting'
                : row.unread === false
                  ? 'read'
                  : 'unknown',
      })),
    );
    conversations.sort(
      (a, b) =>
        b.changedAt - a.changedAt ||
        a.order - b.order ||
        a.profileName.localeCompare(b.profileName, 'pt-BR') ||
        a.key.localeCompare(b.key),
    );
    return { accounts, conversations };
  }
  find(key, profiles) {
    return this.state(profiles).conversations.find((c) => c.key === key);
  }
  export() {
    return [...this.accounts].map(([id, entry]) => ({ id, ...entry }));
  }
  restore(entries, profiles) {
    if (!Array.isArray(entries)) return;
    const allowed = new Set(profiles.map((p) => p.id));
    for (const entry of entries) {
      if (!allowed.has(entry.id)) continue;
      const rows = validateRows(entry.rows).map((row, order) => ({ ...row, order, changedAt: 0 }));
      this.accounts.set(entry.id, {
        rows,
        status: 'PAUSED',
        observedAt: Number.isFinite(entry.observedAt) ? entry.observedAt : null,
      });
    }
  }
}
module.exports = {
  readChatDocument,
  activateChatDocument,
  conversationDocument,
  dismissAppPromotion,
  validateRows,
  UnifiedInbox,
};
