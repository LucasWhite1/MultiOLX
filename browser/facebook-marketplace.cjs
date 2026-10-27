// Public DOM only: never reads the general Messenger thread list or page internals.
async function marketplaceDocument(command = {}) {
  if (location.origin !== 'https://www.facebook.com') return { status: 'AUTH_REQUIRED' };
  if (
    document.querySelector('input[type=password]') ||
    /login|checkpoint|two_step_verification/.test(location.pathname)
  )
    return { status: 'AUTH_REQUIRED' };
  const selectedThread = /^\/messages\/t\/(\d+)\/?$/.exec(location.pathname)?.[1];
  if (selectedThread) {
    // Never import the general Messenger list from the full thread page.
    if (!(command.known || []).some((row) => row.externalId === selectedThread))
      return { status: 'LAYOUT_CHANGED' };
    return {
      status: document.querySelector('[contenteditable=true][role=textbox],textarea')
        ? 'DETAIL'
        : 'OPENING',
    };
  }
  if (!/^\/marketplace\/inbox\/?$/.test(location.pathname)) return { status: 'LAYOUT_CHANGED' };
  const visible = (n) =>
    n instanceof HTMLElement &&
    n.getClientRects().length > 0 &&
    !n.closest('[aria-hidden=true]') &&
    getComputedStyle(n).visibility !== 'hidden';
  const normalized = (s) => s.replace(/\s+/g, ' ').trim();
  const point = (n) => {
    const r = n.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  };
  const press = (n) => {
    if (!n) return;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      const EventClass = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      n.dispatchEvent(new EventClass(type, { bubbles: true, button: 0 }));
    }
    n.click();
  };
  const threadId = (a) => {
    try {
      const u = new URL(a.href);
      return (
        u.origin === 'https://www.facebook.com' &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        /^\/messages\/t\/(\d+)\/?$/.exec(u.pathname)?.[1]
      );
    } catch {
      return null;
    }
  };
  function folder() {
    for (const h of document.querySelectorAll('header,h1,h2,[role=heading]')) {
      if (!visible(h) || normalized(h.innerText) !== 'Marketplace') continue;
      let root = h.parentElement;
      for (let i = 0; i < 4 && root && !root.querySelector('a[href*="/messages/t/"]'); i++)
        root = root.parentElement;
      if (
        root &&
        !root.matches('body,html') &&
        !root.querySelector('[contenteditable=true]') &&
        !root.querySelector('header header') &&
        (root.querySelector('a[href*="/messages/t/"]') ||
          /Nenhuma conversa|No conversations|Nenhuma mensagem/i.test(root.innerText))
      )
        return root;
    }
    return null;
  }
  function popups() {
    const result = [];
    for (const close of document.querySelectorAll(
      '[aria-label="Fechar conversa"],[aria-label="Close chat"]',
    )) {
      if (!visible(close)) continue;
      for (
        let p = close.parentElement, i = 0;
        p && i < 10 && !p.matches('body,html');
        p = p.parentElement, i++
      ) {
        if (p.querySelector('[role=main],main,[role=dialog][aria-label=Messenger],header')) break;
        if (
          p.querySelectorAll('[aria-label="Fechar conversa"],[aria-label="Close chat"]').length !==
          1
        )
          break;
        const market = [...p.querySelectorAll('span,a')].some(
          (n) => visible(n) && normalized(n.textContent) === 'Marketplace',
        );
        if (
          market &&
          (p.querySelector('[contenteditable=true]') || p.querySelector('[aria-label="Mensagens"]'))
        ) {
          result.push({ root: p, close });
          break;
        }
      }
    }
    return result;
  }
  if (command.action === 'close') {
    let closed = 0;
    for (const p of popups()) {
      if (command.caption && !normalized(p.root.innerText).startsWith(normalized(command.caption)))
        continue;
      return { closed: 1, nativeClick: point(p.close) };
    }
    return { closed, remaining: popups().length };
  }
  if (command.ensure) {
    const p = popups()[0];
    if (p) return { status: 'LOADING', nativeClick: point(p.close) };
  }
  let root = folder();
  // The main Marketplace inbox is stable when Facebook closes its Messenger popover.
  // Its controls expose captions rather than thread IDs; reuse verified IDs where
  // unique, otherwise derive a local key and reopen through that same public row.
  if (
    (!root || command.ensure) &&
    ['read', 'inspect', 'open', 'open-thread', 'scroll'].includes(command.action || 'read')
  ) {
    const main = document.querySelector('[role=main]') || document.querySelector('main');
    const tabs = main && [...document.querySelectorAll('[role=tab]')].filter(visible);
    const selected = tabs?.find((t) => t.getAttribute('aria-selected') === 'true');
    const tab =
      selected &&
      { Compra: 'buy', Venda: 'sell', Buying: 'buy', Selling: 'sell' }[
        normalized(selected.innerText)
      ];
    if (
      main &&
      tab &&
      tabs.some((t) => /^(Compra|Buying)$/.test(normalized(t.innerText))) &&
      tabs.some((t) => /^(Venda|Selling)$/.test(normalized(t.innerText)))
    ) {
      const source = [];
      for (const n of main.querySelectorAll('[role=button]')) {
        const lines = n.innerText.split('\n').map(normalized).filter(Boolean);
        if (
          lines.length < 3 ||
          !/^(?:\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|Hoje|Ontem|Agora|Today|Yesterday|\d+\s*(?:min|h|d|anos?|years?|sem))$/i.test(
            lines.at(-1),
          )
        )
          continue;
        const contact = lines[0];
        const hasTitle = /^·\s*/.test(lines[1]);
        const title = hasTitle ? lines[1].replace(/^·\s*/, '') : '';
        const preview = lines.slice(hasTitle ? 2 : 1, -1).join(' ');
        let matches = (command.known || []).filter(
          (k) => k.contact === contact && (!title || normalized(k.listingTitle) === title),
        );
        if (matches.length > 1)
          matches = matches.filter(
            (k) => k.preview.replace(/^(?:Você|You|[^:]{1,80}):\s*/, '') === preview,
          );
        if (!matches.length && contact === 'Usuário do Facebook' && !title) {
          matches = (command.known || []).filter(
            (k) =>
              k.contact === 'Marketplace' &&
              k.preview.replace(/^(?:Você|You|[^:]{1,80}):\s*/, '') === preview,
          );
        }
        if (matches.length > 1) continue;
        const known = matches[0];
        const caption = contact + (title ? ' · ' + title : '');
        const hash = [
          ...new Uint8Array(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tab + '|' + caption)),
          ),
        ]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const id = known?.externalId || `marketplace-${tab}-${hash}`;
        const unchanged =
          known && known.preview.replace(/^(?:Você|You|[^:]{1,80}):\s*/, '') === preview;
        const marker = [n, ...n.querySelectorAll('[aria-label]')].some((e) =>
          /mensage(?:m|ns) não lida|unread message/i.test(e.getAttribute('aria-label') || ''),
        );
        source.push({
          node: n,
          row: {
            externalId: id,
            url: known?.url || `https://www.facebook.com/marketplace/inbox/?multiolx-thread=${id}`,
            contact: contact.slice(0, 300),
            listingTitle: (title || known?.listingTitle || 'Marketplace').slice(0, 500),
            preview: unchanged ? known.preview : preview.slice(0, 10000),
            timeLabel: lines.at(-1).slice(0, 100),
            unread: marker ? true : unchanged ? known.unread : null,
            unreadCount: null,
            lastDirection: unchanged ? known.lastDirection : 'unknown',
            platform: 'facebook-marketplace',
            marketplaceTab: tab,
          },
        });
      }
      if (command.action === 'scroll') {
        let s = source.at(-1)?.node.parentElement;
        while (
          s &&
          s !== main &&
          !(
            s.scrollHeight > s.clientHeight + 10 &&
            /auto|scroll/.test(getComputedStyle(s).overflowY)
          )
        )
          s = s.parentElement;
        if (!s || s === main) return { moved: false };
        const before = s.scrollTop;
        s.scrollTop = command.top ? 0 : s.scrollTop + Math.max(400, s.clientHeight - 60);
        return { moved: s.scrollTop !== before };
      }
      if (command.action === 'open' || command.action === 'open-thread') {
        const found = source.filter((s) => s.row.externalId === String(command.id || command.text));
        if (found.length === 1)
          return {
            clicked: true,
            caption: found[0].node.innerText.split('\n').slice(0, 2).map(normalized).join(' '),
            nativeClick: point(found[0].node),
          };
        const wanted = (command.known || []).find(
          (k) => k.externalId === String(command.id || command.text),
        );
        const target = tabs.find(
          (t) =>
            ({ Compra: 'buy', Venda: 'sell', Buying: 'buy', Selling: 'sell' })[
              normalized(t.innerText)
            ] === (wanted?.marketplaceTab || (tab === 'sell' ? 'buy' : 'sell')),
        );
        if (target && target !== selected) {
          press(target);
          return { clicked: false, switched: true };
        }
        return { clicked: false };
      }
      const empty = /Nenhuma conversa|No conversations/i.test(main.innerText);
      if (source.length || empty) {
        if (command.ensure && (empty || Date.now() - (window.__multiolxFBTabTime || 0) > 15000)) {
          window.__multiolxFBTabTime = Date.now();
          const next = tabs.find((t) => t !== selected);
          press(next);
          if (empty && !window.__multiolxFBEmptyScanned) {
            window.__multiolxFBEmptyScanned = true;
            return { status: 'LOADING', diagnostic: { step: 'marketplace-tab' } };
          }
        }
        return {
          status: 'READY',
          conversations: source.map((s) => s.row).slice(0, 200),
          partial: true,
          marketplace: true,
          openConversations: popups().length,
          diagnostic: { source: 'marketplace-main', tab, rows: source.length },
        };
      }
    }
  }
  if (command.action === 'structure')
    return {
      path: location.pathname,
      main: !!document.querySelector('[role=main],main'),
      tabs: [...document.querySelectorAll('[role=tab]')].map((n) => ({
        text: n.innerText,
        selected: n.getAttribute('aria-selected'),
        label: n.getAttribute('aria-label'),
      })),
      nativeRows: [...document.querySelectorAll('[role=main] [role=button]')]
        .map((n) => ({
          lines: n.innerText.split('\n').length,
          last: n.innerText.split('\n').at(-1),
        }))
        .filter((r) => r.lines >= 3)
        .slice(0, 4),
      folder: !!root,
      title: document.title,
      bodyLength: document.body.innerText.length,
      unavailable:
        /Esta página não está disponível|Este conteúdo não está disponível|Página não encontrada|content isn't available|page isn't available/i.test(
          document.body.innerText,
        ),
      headingRoles: [...document.querySelectorAll('h1,h2,[role=heading]')].map((n) => ({
        tag: n.tagName,
        marketplace: /Marketplace/i.test(n.innerText),
        length: n.innerText.length,
      })),
      headers: [...document.querySelectorAll('header,h1,h2,[role=heading]')]
        .filter((n) => normalized(n.innerText) === 'Marketplace')
        .map((n) => ({
          tag: n.tagName,
          visible: visible(n),
          parents: (() => {
            let r = [];
            for (let p = n.parentElement, i = 0; p && i < 5; p = p.parentElement, i++)
              r.push({
                tag: p.tagName,
                role: p.getAttribute('role'),
                links: p.querySelectorAll('a[href*="/messages/t/"]').length,
              });
            return r;
          })(),
        })),
    };
  if (!root) {
    if (!command.ensure) return { status: popups().length ? 'DETAIL' : 'LOADING' };
    const dialog = [...document.querySelectorAll('[role=dialog][aria-label=Messenger]')].find(
      visible,
    );
    const candidates = dialog
      ? [...dialog.querySelectorAll('[role=button],[role=link],a')].filter(
          (n) =>
            visible(n) &&
            n.getAttribute('role') === 'button' &&
            !n.querySelector('a[href*="/messages/t/"]') &&
            n.innerText.trim().split('\n')[0] === 'Marketplace',
        )
      : [];
    if (candidates.length === 1) {
      press(candidates[0]);
      return {
        status: 'LOADING',
        diagnostic: { step: 'select-marketplace' },
      };
    }
    if (!dialog && Date.now() - (window.__multiolxFBFolderClick || 0) > 3000) {
      const messenger = [...document.querySelectorAll('[role=button][aria-label=Messenger]')].find(
        visible,
      );
      if (messenger) {
        window.__multiolxFBFolderClick = Date.now();
        press(messenger);
        return {
          status: 'LOADING',
          diagnostic: { step: 'open-messenger' },
        };
      }
    }
    return {
      status: 'LOADING',
      diagnostic: {
        visibility: document.visibilityState,
        focused: document.hasFocus(),
        dialog: !!dialog,
        dialogLabels: [...document.querySelectorAll('[role=dialog]')]
          .filter(visible)
          .map((n) => ({
            label: n.getAttribute('aria-label'),
            marketplaceControls: [...n.querySelectorAll('[role=button],[role=link],a')]
              .filter((e) => visible(e) && e.innerText.trim().split('\n')[0] === 'Marketplace')
              .map((e) => ({ role: e.getAttribute('role'), tag: e.tagName })),
          })),
        candidates: candidates.length,
        messenger: [...document.querySelectorAll('[role=button][aria-label=Messenger]')].filter(
          visible,
        ).length,
      },
    };
  }
  const anchors = [...root.querySelectorAll('a[href]')].filter((a) => threadId(a));
  if (command.action === 'open' || command.action === 'open-thread') {
    const matches = anchors.filter((a) => threadId(a) === String(command.id || command.text));
    if (matches.length !== 1) return { clicked: false };
    const caption = normalized(
      (matches[0].getAttribute('aria-label') || matches[0].innerText.split('\n')[0]).replace(
        /^Conversa em grupo:\s*/i,
        '',
      ),
    );
    return { clicked: true, caption, nativeClick: point(matches[0]) };
  }
  if (command.action === 'scroll') {
    const node = anchors.at(-1);
    let scroll = node?.parentElement;
    while (
      scroll &&
      scroll !== root &&
      !(
        scroll.scrollHeight > scroll.clientHeight + 10 &&
        /auto|scroll/.test(getComputedStyle(scroll).overflowY)
      )
    )
      scroll = scroll.parentElement;
    if (!scroll || scroll === root) return { moved: false };
    const before = scroll.scrollTop;
    scroll.scrollTop = command.top ? 0 : scroll.scrollTop + Math.max(400, scroll.clientHeight - 60);
    return { moved: scroll.scrollTop !== before };
  }
  const seen = new Set(),
    conversations = [];
  for (const a of anchors) {
    const id = threadId(a);
    if (seen.has(id)) continue;
    seen.add(id);
    const lines = a.innerText
      .split('\n')
      .map(normalized)
      .filter((s) => s && s !== '·');
    if (lines.length < 2) continue;
    const caption = normalized(
      (a.getAttribute('aria-label') || lines[0]).replace(/^Conversa em grupo:\s*/i, ''),
    );
    const split = caption.indexOf(' · ');
    const contact = split >= 0 ? caption.slice(0, split) : 'Marketplace';
    const listingTitle = split >= 0 ? caption.slice(split + 3) : caption;
    const unread = lines.some((s) => /^Mensagem não lida:|^Unread message:/i.test(s));
    const content = lines
      .slice(1, -1)
      .filter((s) => !/^Mensagem não lida:|^Unread message:/i.test(s));
    const preview = content.join(' ');
    conversations.push({
      externalId: id,
      url: `https://www.facebook.com/messages/t/${id}/`,
      contact: contact.slice(0, 300),
      listingTitle: listingTitle.slice(0, 500),
      preview: preview.slice(0, 10000),
      timeLabel: lines.at(-1).slice(0, 100),
      unread,
      unreadCount: null,
      lastDirection: /^(Você|You):/i.test(preview)
        ? 'outgoing'
        : contact !== 'Marketplace' && preview.startsWith(contact + ':')
          ? 'incoming'
          : 'unknown',
      platform: 'facebook-marketplace',
    });
    if (conversations.length === 200) break;
  }
  return {
    status: 'READY',
    conversations,
    partial: anchors.length > 0,
    marketplace: true,
    openConversations: popups().length,
  };
}
module.exports = { marketplaceDocument, inspectMarketplaceDocument: marketplaceDocument };
