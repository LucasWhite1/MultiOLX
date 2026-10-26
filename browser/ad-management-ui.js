(() => {
  const api = window.multiBrowser,
    $ = (id) => document.getElementById(id);
  let state = { items: [], accounts: [], results: [] },
    profiles = [],
    review = null,
    fetching = false,
    rendered = '';
  const selected = new Set();
  const statuses = {
    QUEUED: 'Na fila',
    RUNNING: 'Em andamento',
    READY: 'Consultada',
    ERROR: 'Precisa de atenção',
    DELETED: 'Excluído',
    UNCERTAIN: 'Confira na OLX',
    CANCELLED: 'Cancelado',
  };
  const node = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  function error(e) {
    $('managedAdStatus').textContent = e.message;
  }
  function selection() {
    $('reviewAdRemoval').textContent = `Revisar exclusão (${selected.size})`;
    $('reviewAdRemoval').disabled = !selected.size || state.running;
  }
  function rows() {
    const query = $('managedAdSearch').value.trim().toLocaleLowerCase('pt-BR'),
      owner = $('managedAdOwner').value;
    const filtered = state.items.filter(
      (r) =>
        (!owner || r.owner === owner) &&
        (!query || (r.title + ' ' + r.id).toLocaleLowerCase('pt-BR').includes(query)),
    );
    const groups = new Map();
    for (const item of filtered) {
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group).push(item);
    }
    $('managedAdRows').replaceChildren(
      ...[...groups.values()].map((items) => {
        const card = node('article', undefined, 'managed-ad-card');
        card.append(node('h3', items[0].title));
        const allSameTitle = state.items.filter((r) => r.group === items[0].group);
        const owners = new Set(allSameTitle.map((r) => r.owner));
        if (allSameTitle.length > 1) {
          const same = node(
            'button',
            `Selecionar mesmo título · ${allSameTitle.length} anúncios em ${owners.size} conta${owners.size === 1 ? '' : 's'}`,
          );
          same.type = 'button';
          same.disabled = state.running;
          same.onclick = () => {
            for (const item of allSameTitle) selected.add(item.key);
            rows();
          };
          card.append(
            same,
            node(
              'p',
              'Títulos iguais podem ter preços e conteúdos diferentes. Confira todos na revisão.',
              'hint',
            ),
          );
        }
        for (const item of items) {
          const row = node('div', undefined, 'managed-ad-row'),
            label = node('label'),
            check = node('input');
          check.type = 'checkbox';
          check.checked = selected.has(item.key);
          check.disabled = state.running;
          check.setAttribute(
            'aria-label',
            `Selecionar ${item.title} · ${item.profileName} · ID ${item.id}`,
          );
          check.onchange = () => {
            if (check.checked) selected.add(item.key);
            else selected.delete(item.key);
            selection();
          };
          label.append(
            check,
            node(
              'span',
              `${item.profileName} · ${item.price || 'Preço não informado'} · ID ${item.id}`,
            ),
          );
          const remove = node('button', 'Excluir');
          remove.type = 'button';
          remove.className = 'danger';
          remove.disabled = state.running;
          remove.setAttribute(
            'aria-label',
            `Excluir ${item.title} · ${item.profileName} · ID ${item.id}`,
          );
          remove.onclick = () => prepare([item.key]).catch(error);
          row.append(label, remove);
          card.append(row);
        }
        return card;
      }),
    );
    if (!filtered.length && !state.running)
      $('managedAdRows').append(node('p', 'Nenhum anúncio nesta consulta.'));
    selection();
  }
  function render(next) {
    const signature = JSON.stringify(next);
    if (signature === rendered) return;
    rendered = signature;
    state = next;
    for (const key of selected) if (!state.items.some((r) => r.key === key)) selected.delete(key);
    const running = state.accounts.find((r) => r.status === 'RUNNING');
    $('managedAdStatus').textContent =
      state.error ||
      (state.running
        ? state.phase === 'scan'
          ? `Consultando ${running?.name || 'contas'}…`
          : 'Excluindo os anúncios confirmados…'
        : `${state.items.length} anúncios consultados. `) +
        state.accounts
          .map((r) => `${r.name}: ${statuses[r.status]}${r.message ? ' — ' + r.message : ''}`)
          .join(' · ');
    $('scanManagedAds').disabled = state.running;
    $('selectAllManagedAdAccounts').disabled = state.running;
    $('cancelAdManagement').hidden = !state.running;
    for (const input of $('managedAdAccounts').querySelectorAll('input'))
      input.disabled = state.running;
    const owner = $('managedAdOwner').value;
    $('managedAdOwner').replaceChildren(
      new Option('Todas as contas consultadas', ''),
      ...state.accounts.map((r) => new Option(r.name, r.id)),
    );
    $('managedAdOwner').value = owner;
    const results = state.results.length ? state.results : state.history || [];
    $('managedAdResults').hidden = !results.length;
    $('managedAdResultTitle').textContent =
      `Exclusões · ${results.filter((r) => r.status === 'DELETED').length}/${results.length} confirmadas`;
    $('managedAdResultRows').replaceChildren(
      ...results.map((r) => {
        const row = node('div', undefined, 'managed-ad-card');
        row.append(
          node('strong', `${r.profileName} · ${r.title} · ID ${r.id}`),
          node('p', `${statuses[r.status] || r.status}: ${r.message}`),
        );
        return row;
      }),
    );
    rows();
  }
  async function refresh() {
    if (fetching) return;
    fetching = true;
    try {
      render(await api.managedAds());
    } finally {
      fetching = false;
    }
  }
  $('adManager').ontoggle = async () => {
    if (!$('adManager').open) return;
    try {
      profiles = (await api.listListings()).profiles;
      const checked = new Set(
        [...$('managedAdAccounts').querySelectorAll('input:checked')].map((n) => n.value),
      );
      $('managedAdAccounts').replaceChildren();
      for (const profile of profiles) {
        const label = node('label'),
          check = node('input');
        check.type = 'checkbox';
        check.value = profile.id;
        check.checked = checked.has(profile.id);
        check.disabled = state.running;
        label.append(check, node('span', profile.name));
        $('managedAdAccounts').append(label);
      }
      await refresh();
    } catch (e) {
      error(e);
    }
  };
  $('selectAllManagedAdAccounts').onclick = () => {
    for (const input of $('managedAdAccounts').querySelectorAll('input')) input.checked = true;
  };
  $('scanManagedAds').onclick = async () => {
    try {
      const owners = [...$('managedAdAccounts').querySelectorAll('input:checked')].map(
        (n) => n.value,
      );
      selected.clear();
      render(await api.scanManagedAds(owners));
    } catch (e) {
      error(e);
    }
  };
  $('cancelAdManagement').onclick = () => api.cancelAdManagement().then(render).catch(error);
  $('managedAdSearch').oninput = rows;
  $('managedAdOwner').onchange = rows;
  $('clearManagedAdSelection').onclick = () => {
    selected.clear();
    rows();
  };
  async function prepare(keys) {
    review = await api.reviewAdRemoval(keys);
    $('adRemovalReview').replaceChildren(
      ...review.items.map((r) => {
        const row = node('div', undefined, 'managed-ad-card');
        row.append(
          node('strong', r.title),
          node('p', `${r.profileName} · ${r.price || 'Sem preço'} · ID ${r.id}`),
        );
        return row;
      }),
    );
    $('adRemovalError').textContent = '';
    $('confirmAdRemoval').textContent =
      `Excluir ${review.items.length} anúncio${review.items.length === 1 ? '' : 's'}`;
    $('adRemovalDialog').showModal();
  }
  $('reviewAdRemoval').onclick = () => prepare([...selected]).catch(error);
  $('cancelAdRemoval').onclick = () => {
    review = null;
    $('adRemovalDialog').close();
  };
  $('confirmAdRemoval').onclick = async () => {
    if (!review) return;
    $('confirmAdRemoval').disabled = true;
    try {
      render(await api.removeAds(review.token));
      review = null;
      selected.clear();
      $('adRemovalDialog').close();
      $('managedAdResults').open = false;
    } catch (e) {
      $('adRemovalError').textContent = e.message;
    } finally {
      $('confirmAdRemoval').disabled = false;
    }
  };
  setInterval(() => {
    if ($('adManager').open && !$('listingWorkspace').hidden && !document.hidden)
      refresh().catch(error);
  }, 1200);
})();
