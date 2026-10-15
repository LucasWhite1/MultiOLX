const api = window.multiBrowser;
let profiles = [],
  active = null;
let mode = 'individual',
  inbox = { accounts: [], conversations: [] },
  selectedKey = null;
let openingKey = null;
const el = (id) => document.getElementById(id);
function status(message, error = false) {
  el('status').textContent = message;
  el('status').classList.toggle('error', error);
}
async function act(work) {
  try {
    await work();
  } catch (error) {
    status(error.message, true);
  }
}
async function render() {
  profiles = await api.list();
  el('profiles').replaceChildren();
  for (const profile of profiles) {
    const button = document.createElement('button');
    button.textContent = profile.name;
    button.classList.toggle('active', profile.id === active);
    button.onclick = () =>
      act(async () => {
        await api.open(profile.id);
        active = profile.id;
        setMode('individual');
        await render();
      });
    el('profiles').append(button);
  }
  for (const id of ['rename', 'reload', 'home', 'chat', 'close'])
    el(id).disabled = mode !== 'individual' || !active;
}
function setMode(value) {
  mode = value;
  el('listingWorkspace').hidden = mode !== 'listings';
  el('unifiedInbox').hidden = mode !== 'unified';
  document.querySelector('.welcome').hidden = mode !== 'individual';
  el('unified').classList.toggle('active', mode === 'unified');
  for (const id of ['rename', 'reload', 'home', 'chat', 'close'])
    el(id).disabled = mode !== 'individual' || !active;
  if (mode === 'unified') el('reload').disabled = !selectedKey;
}
function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}
function renderInbox() {
  const filter = el('inboxFilter').value;
  el('inboxFilter').replaceChildren(
    new Option('Todas as contas', ''),
    ...inbox.accounts.map((a) => new Option(a.name, a.id)),
  );
  el('inboxFilter').value = filter;
  el('inboxAccounts').replaceChildren(
    ...inbox.accounts.map((a) => {
      const row = text('div', `${a.name} · ${a.message}`, 'source-status');
      row.classList.toggle(
        'problem',
        ['BLOCKED', 'AUTH_REQUIRED', 'LAYOUT_CHANGED', 'ERROR'].includes(a.status),
      );
      return row;
    }),
  );
  const query = el('inboxSearch').value.trim().toLocaleLowerCase('pt-BR');
  const attention = el('attentionFilter').value;
  el('filterToggle').classList.toggle('filters-active', !!(filter || attention));
  el('filterToggle').setAttribute(
    'aria-label',
    filter || attention ? 'Filtrar conversas · filtros ativos' : 'Filtrar conversas',
  );
  const rows = inbox.conversations.filter(
    (c) =>
      (!filter || c.profileId === filter) &&
      (!attention || c.attention === attention) &&
      (!query ||
        [c.contact, c.listingTitle, c.preview, c.profileName]
          .join(' ')
          .toLocaleLowerCase('pt-BR')
          .includes(query)),
  );
  el('inboxCount').textContent =
    `${rows.length} conversa${rows.length === 1 ? '' : 's'} · ${inbox.accounts.length} contas`;
  if (inbox.resources) {
    el('pageBudget').value = String(inbox.resources.limit);
    el('economy').checked = inbox.resources.economy !== false;
    el('resourceStats').textContent =
      `${inbox.resources.activePages}/${inbox.resources.limit} páginas ativas`;
  }
  const position = el('inboxRows').scrollTop;
  el('inboxRows').replaceChildren(
    ...rows.map((c) => {
      const button = document.createElement('button');
      button.className = 'conversation-row';
      button.classList.add(`attention-${c.attention || 'unknown'}`);
      button.classList.toggle('selected', c.key === selectedKey);
      button.dataset.key = c.key;
      button.disabled = !!openingKey;
      const meta = document.createElement('div');
      meta.className = 'conversation-meta';
      meta.append(text('span', c.profileName, 'account-tag'), text('span', c.timeLabel));
      if (c.attention === 'unread') {
        const badge = text(
          'span',
          c.unreadCount ? String(c.unreadCount) : '',
          c.unreadCount ? 'unread-badge' : 'unread-dot',
        );
        badge.setAttribute(
          'aria-label',
          c.unreadCount
            ? `${c.unreadCount} mensagens não lidas`
            : 'Mensagem não lida; quantidade não informada pela OLX',
        );
        meta.append(badge);
      }
      const labels = {
        unread: 'Não visualizada',
        awaiting: 'Visualizada · aguarda sua resposta',
        outgoing: 'Última mensagem enviada por você',
        read: 'Visualizada · autoria não identificada',
        unknown: 'Estado não identificado',
      };
      button.append(
        meta,
        text('strong', c.contact),
        text('span', c.listingTitle, 'listing-title'),
        text(
          'span',
          c.lastDirection === 'outgoing' && !/^Você:/i.test(c.preview)
            ? `Você: ${c.preview}`
            : c.preview,
          'conversation-preview',
        ),
        text('small', labels[c.attention] || labels.unknown, 'attention-label'),
      );
      if (c.stale)
        button.append(text('small', 'Última leitura · confira a conexão da conta', 'stale'));
      else if (c.paused) button.append(text('small', 'Em espera · abre ao selecionar', 'paused'));
      button.onclick = () =>
        act(async () => {
          openingKey = c.key;
          status(`Abrindo conversa na conta ${c.profileName}…`);
          renderInbox();
          try {
            await api.openConversation(c.key);
          } finally {
            openingKey = null;
            renderInbox();
          }
          selectedKey = c.key;
          el('conversationOwner').textContent = `Conta: ${c.profileName}`;
          renderInbox();
          status(
            `Conversa de ${c.contact} · conta ${c.profileName}. Responda diretamente no chat da OLX.`,
          );
        });
      return button;
    }),
  );
  if (!rows.length)
    el('inboxRows').append(
      text(
        'p',
        query || filter || attention
          ? 'Nenhuma conversa corresponde ao filtro.'
          : 'As conversas aparecerão quando os chats carregarem. Contas vazias são identificadas pela OLX.',
        'inbox-empty',
      ),
    );
  el('inboxRows').scrollTop = position;
}
el('unified').onclick = () =>
  act(async () => {
    setMode('unified');
    active = null;
    selectedKey = null;
    inbox = await api.unified();
    renderInbox();
  });
el('allChats').onclick = () => el('unified').click();
el('refreshInbox').onclick = () =>
  act(async () => {
    el('refreshInbox').disabled = true;
    try {
      inbox = await api.refreshInbox();
      renderInbox();
    } finally {
      el('refreshInbox').disabled = false;
    }
  });
el('inboxSearch').oninput = renderInbox;
el('inboxFilter').onchange = renderInbox;
el('attentionFilter').onchange = renderInbox;
el('clearFilters').onclick = () => {
  el('inboxFilter').value = '';
  el('attentionFilter').value = '';
  renderInbox();
};
el('economy').onchange = () =>
  act(async () => {
    try {
      await api.economy(el('economy').checked);
      status('Modo de economia atualizado.');
    } catch (error) {
      el('economy').checked = !el('economy').checked;
      throw error;
    }
  });
api.onInbox((state) => {
  inbox = state;
  renderInbox();
});
api.onResources((state) => {
  el('resourceStats').textContent =
    `${state.activePages}/${state.limit} páginas · ~${state.memoryMB} MB`;
  el('pageBudget').value = String(state.limit);
});
el('pageBudget').onchange = () =>
  act(async () => {
    try {
      await api.budget(Number(el('pageBudget').value));
      status('Limite de páginas atualizado. Contas em espera preservam a sessão.');
    } catch (error) {
      const current = await api.budget();
      el('pageBudget').value = String(current.limit);
      throw error;
    }
  });
el('create').onsubmit = (event) => {
  event.preventDefault();
  void act(async () => {
    const profile = await api.create(el('name').value);
    el('name').value = '';
    await render();
    status(`Perfil ${profile.name} criado. Selecione-o para entrar na OLX.`);
  });
};
el('rename').onclick = () =>
  act(async () => {
    const profile = profiles.find((p) => p.id === active);
    el('renameName').value = profile.name;
    el('renameDialog').showModal();
  });
el('cancelRename').onclick = () => el('renameDialog').close();
el('renameForm').onsubmit = (event) => {
  event.preventDefault();
  void act(async () => {
    await api.rename(active, el('renameName').value);
    el('renameDialog').close();
    await render();
  });
};
for (const id of ['back', 'forward', 'reload', 'home', 'chat'])
  el(id).onclick = () => act(() => api.navigate(id));
el('close').onclick = () =>
  act(async () => {
    await api.close();
    active = null;
    await render();
  });
api.onState((state) => {
  if (state.profileId !== undefined) active = state.profileId;
  if (state.focusChat !== undefined) el('allChats').hidden = !state.focusChat;
  if (state.location === 'Chats unificados') el('allChats').hidden = true;
  if (state.conversationKey) {
    selectedKey = state.conversationKey;
    active = state.profileId;
    renderInbox();
  }
  if (state.mode) setMode(state.mode);
  if (state.source !== undefined) {
    el('currentSource').textContent = state.source ? `Conta: ${state.source}` : '';
    el('currentSource').hidden = !state.source;
  }
  if (state.location) el('location').textContent = state.location;
  el('back').disabled = !state.back;
  el('forward').disabled = !state.forward;
  if (state.message) status(state.message, state.error);
});
void act(async () => {
  await render();
  inbox = await api.inbox();
  renderInbox();
  if (profiles.length && !window.multiWeb && !window.multiServerShell) {
    setMode('unified');
    inbox = await api.unified();
    renderInbox();
  }
});
