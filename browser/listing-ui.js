(() => {
  const api = window.multiBrowser,
    $ = (id) => document.getElementById(id);
  const labels = {
    title: 'Título',
    description: 'Descrição',
    price: 'Preço (R$)',
    postalCode: 'CEP',
    category: 'Categoria',
    group: 'Tipo de anúncio',
    details: 'Informações para a IA',
    condition: 'Condição do produto',
  };
  let data = { drafts: [], assets: [], profiles: [] },
    draft = null,
    timer,
    saveQueue = Promise.resolve(),
    editVersion = 0,
    savedVersion = 0,
    currentPreparation = null;
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  function notice(message, error = false) {
    $('listingNotice').textContent = message;
    $('listingNotice').classList.toggle('error', error);
  }
  const run = (fn) =>
    Promise.resolve()
      .then(fn)
      .catch((e) => {
        notice(e.message, true);
        $('status').textContent = e.message;
      });
  function changed() {
    editVersion++;
    notice('Alterações pendentes…');
    clearTimeout(timer);
    timer = setTimeout(() => run(save), 800);
  }
  function save() {
    clearTimeout(timer);
    saveQueue = saveQueue
      .catch(() => {})
      .then(async () => {
        if (!draft || savedVersion === editVersion) return draft;
        const version = editVersion,
          id = draft.id;
        const result = await api.saveListing(structuredClone(draft));
        if (draft.id === id) {
          draft.revision = result.revision;
          draft.deliveries = result.deliveries;
          savedVersion = version;
          notice(
            version === editVersion
              ? window.multiWeb
                ? 'Rascunho salvo no servidor.'
                : 'Rascunho salvo neste computador.'
              : 'Alterações pendentes…',
          );
        }
        const index = data.drafts.findIndex((d) => d.id === id);
        if (index >= 0) data.drafts[index] = result;
        return result;
      });
    return saveQueue;
  }
  function effective(owner) {
    return { ...draft.base, ...draft.overrides[owner], photos: draft.photos };
  }
  function photo(id) {
    return data.assets.find((a) => a.id === id);
  }
  function thumbnail(id) {
    const asset = photo(id),
      image = node('img');
    image.src = asset?.thumbnail || '';
    image.alt = asset?.name || 'Foto';
    return image;
  }
  function updateReviewButton() {
    const count = draft?.targets.length || 0;
    $('reviewListing').textContent = `Publicar em ${count} conta${count === 1 ? '' : 's'}`;
    $('reviewListing').disabled = !count;
    renderCoverPreview();
  }
  function renderCoverPreview() {
    $('listingCoverPreview').replaceChildren();
    if (!draft?.rotateCover || !draft.photos.length) return;
    for (const [index, owner] of draft.targets.entries()) {
      const profile = data.profiles.find((p) => p.id === owner);
      const photoIndex = index % draft.photos.length;
      const row = node('div', undefined, 'listing-cover-preview');
      row.append(
        thumbnail(draft.photos[photoIndex]),
        node('span', `${profile?.name || 'Conta'} · Foto ${photoIndex + 1}`),
      );
      $('listingCoverPreview').append(row);
    }
  }
  $('rotateListingCover').onchange = () => {
    if (!draft) return;
    draft.rotateCover = $('rotateListingCover').checked;
    changed();
    renderCoverPreview();
  };
  function renderPhotos() {
    $('listingPhotos').replaceChildren(
      ...draft.photos.map((id, index) => {
        const card = node('div', undefined, 'listing-photo');
        card.append(thumbnail(id));
        const actions = node('div');
        if (index) {
          const move = node('button', '←');
          move.type = 'button';
          move.title = 'Mover foto para a esquerda';
          move.onclick = () => {
            [draft.photos[index - 1], draft.photos[index]] = [
              draft.photos[index],
              draft.photos[index - 1],
            ];
            changed();
            renderPhotos();
          };
          actions.append(move);
        }
        const remove = node('button', 'Remover');
        remove.type = 'button';
        remove.onclick = () => {
          draft.photos = draft.photos.filter((x) => x !== id);
          changed();
          renderPhotos();
        };
        actions.append(remove);
        card.append(actions);
        return card;
      }),
    );
    $('photoCount').textContent = `${draft.photos.length}/20 fotos`;
    renderCoverPreview();
  }
  function renderAccounts() {
    const expanded = new Set(
      [...$('listingAccounts').querySelectorAll('details[open]')].map((n) => n.dataset.profileId),
    );
    $('listingAccounts').replaceChildren(
      ...data.profiles.map((profile) => {
        const card = node('details', undefined, 'listing-account'),
          head = node('summary');
        card.dataset.profileId = profile.id;
        card.open = expanded.has(profile.id);
        const select = node('input');
        select.type = 'checkbox';
        select.checked = draft.targets.includes(profile.id);
        select.setAttribute('aria-label', `Selecionar ${profile.name}`);
        select.onclick = (e) => e.stopPropagation();
        select.onchange = () => {
          draft.targets = select.checked
            ? [...draft.targets, profile.id]
            : draft.targets.filter((id) => id !== profile.id);
          changed();
          updateReviewButton();
        };
        head.append(select, node('strong', profile.name));
        const custom = Object.keys(draft.overrides[profile.id] || {}).length;
        head.append(
          node(
            'span',
            custom
              ? `${custom} campo${custom === 1 ? '' : 's'} personalizado${custom === 1 ? '' : 's'}`
              : 'Usando anúncio base',
            'listing-inherits',
          ),
        );
        card.append(head);
        const preview = node(
          'p',
          effective(profile.id).title || 'Sem título',
          'listing-effective-title',
        );
        card.append(preview);
        const delivery = draft.deliveries[profile.id];
        if (delivery) card.append(node('p', delivery.message, 'listing-delivery'));
        for (const field of Object.keys(labels)) {
          const row = node('div', undefined, 'override-field'),
            label = node('label'),
            toggle = node('input');
          toggle.type = 'checkbox';
          toggle.checked = Object.hasOwn(draft.overrides[profile.id] || {}, field);
          label.append(
            toggle,
            document.createTextNode(`Personalizar ${labels[field].toLowerCase()}`),
          );
          const input = node(
            ['group', 'condition'].includes(field)
              ? 'select'
              : ['description', 'details'].includes(field)
                ? 'textarea'
                : 'input',
          );
          if (field === 'group')
            for (const group of [
              'Produtos',
              'Automóveis, Peças e Acessórios',
              'Imóveis',
              'Serviços',
              'Vagas de emprego',
            ])
              input.append(new Option(group, group));
          if (field === 'condition') {
            input.append(new Option('Selecione', ''));
            for (const choice of [
              'Novo',
              'Usado - Excelente',
              'Usado - Bom',
              'Recondicionado',
              'Com defeito ou avarias',
            ])
              input.append(new Option(choice, choice));
          }
          input.value = effective(profile.id)[field] || (field === 'group' ? 'Produtos' : '');
          input.disabled = !toggle.checked;
          input.maxLength = {
            title: 90,
            description: 6000,
            price: 14,
            postalCode: 9,
            category: 200,
            details: 2000,
          }[field];
          input.setAttribute('aria-label', `${labels[field]} de ${profile.name}`);
          if (['description', 'details'].includes(field)) input.rows = 4;
          toggle.onchange = () => {
            draft.overrides[profile.id] ||= {};
            if (toggle.checked) draft.overrides[profile.id][field] = draft.base[field];
            else delete draft.overrides[profile.id][field];
            input.disabled = !toggle.checked;
            input.value = effective(profile.id)[field];
            changed();
            preview.textContent = effective(profile.id).title || 'Sem título';
            head.querySelector('.listing-inherits').textContent = Object.keys(
              draft.overrides[profile.id],
            ).length
              ? 'Personalizado'
              : 'Usando anúncio base';
          };
          input.oninput = () => {
            draft.overrides[profile.id][field] = input.value;
            changed();
            preview.textContent = effective(profile.id).title || 'Sem título';
          };
          row.append(label, input);
          card.append(row);
        }
        const reset = node('button', 'Usar todo o anúncio base');
        reset.type = 'button';
        reset.onclick = () => {
          delete draft.overrides[profile.id];
          changed();
          renderAccounts();
        };
        card.append(reset);
        return card;
      }),
    );
    updateReviewButton();
  }
  function loadDraft(value) {
    draft = structuredClone(value);
    $('rotateListingCover').checked = draft.rotateCover === true;
    editVersion = 0;
    savedVersion = 0;
    for (const field of Object.keys(labels)) $('listing-' + field).value = draft.base[field];
    $('draftPicker').replaceChildren(
      ...data.drafts.map((d) => new Option(d.base.title || 'Sem título', d.id)),
    );
    $('draftPicker').value = draft.id;
    renderAccounts();
    renderPhotos();
    notice(window.multiWeb ? 'Rascunho salvo no servidor.' : 'Rascunho salvo neste computador.');
  }
  async function open() {
    data = await api.listings();
    await showAIStatus(await api.listingAI());
    if (!data.drafts.length) {
      const created = await api.createListing();
      data.drafts = [created];
    }
    const next = data.drafts.find((d) => d.id === draft?.id) || data.drafts[0];
    loadDraft(next);
    $('backListings').hidden = true;
    $('sendListing').hidden = true;
    $('fillListing').hidden = true;
    renderBatch(await api.listingBatch());
  }
  function showAIStatus(status) {
    $('listingAIEnabled').checked = status.enabled;
    $('listingAIStatus').textContent =
      (status.configured ? 'Chave configurada. ' : 'Informe a chave. ') +
      status.model +
      (status.servedModel ? ' · Atendido por ' + status.servedModel : '');
  }
  $('saveListingAI').onclick = () =>
    run(async () => {
      const input = $('listingAIKey');
      try {
        showAIStatus(
          await api.configureListingAI({
            key: input.value.trim(),
            enabled: $('listingAIEnabled').checked,
          }),
        );
      } finally {
        input.value = '';
      }
    });
  $('testListingAI').onclick = () =>
    run(async () => {
      $('testListingAI').disabled = true;
      try {
        showAIStatus(await api.testListingAI());
        $('listingAIStatus').textContent += ' · Conexão confirmada.';
      } catch (error) {
        $('listingAIStatus').textContent = error.message;
        throw error;
      } finally {
        $('testListingAI').disabled = false;
      }
    });
  $('listings').onclick = () =>
    run(async () => {
      await save();
      await open();
    });
  $('backListings').onclick = () => run(open);
  $('newListing').onclick = () =>
    run(async () => {
      await save();
      const created = await api.createListing();
      data.drafts.unshift(created);
      loadDraft(created);
    });
  $('draftPicker').onchange = () =>
    run(async () => {
      const id = $('draftPicker').value;
      await save();
      loadDraft(data.drafts.find((d) => d.id === id));
    });
  $('saveListing').onclick = () => run(save);
  for (const field of Object.keys(labels))
    $('listing-' + field).oninput = () => {
      draft.base[field] = $('listing-' + field).value;
      changed();
      renderAccounts();
    };
  $('addListingPhotos').onclick = () =>
    run(async () => {
      const added = await api.pickListingPhotos();
      for (const asset of added)
        if (!data.assets.some((a) => a.id === asset.id)) data.assets.push(asset);
      if (draft.photos.length + added.length > 20) throw new Error('Use até 20 fotos por anúncio.');
      draft.photos.push(...added.map((a) => a.id));
      changed();
      renderPhotos();
      await save();
    });
  $('selectAllListingAccounts').onclick = () => {
    draft.targets = data.profiles.map((p) => p.id);
    changed();
    renderAccounts();
  };
  $('clearListingAccounts').onclick = () => {
    draft.targets = [];
    changed();
    renderAccounts();
  };
  $('reviewListingDetails').onclick = () =>
    run(async () => {
      await save();
      const review = await api.reviewListing(draft.id, draft.revision);
      $('listingReviewCards').replaceChildren(
        ...review.map((item) => {
          const card = node('article', undefined, 'listing-review-card');
          card.append(
            node('h3', item.profileName),
            node('h4', item.listing.title),
            node('p', item.listing.description, 'listing-description-preview'),
            node(
              'p',
              `R$ ${item.listing.price} · CEP ${item.listing.postalCode || 'da conta'} · ${item.listing.category || 'Categoria a conferir na OLX'}`,
            ),
          );
          const photos = node('div', undefined, 'listing-review-photos');
          for (const id of item.listing.photos) photos.append(thumbnail(id));
          card.append(photos);
          if (item.errors.length)
            card.append(node('p', 'Complete: ' + item.errors.join(', '), 'error'));
          if (item.delivery) card.append(node('p', item.delivery.message, 'listing-delivery'));
          if (['REVIEW', 'UNCERTAIN'].includes(item.delivery?.state)) {
            const results = node('div', undefined, 'listing-result-actions');
            for (const [value, label] of [
              ['published', 'Conferi na OLX: foi enviado'],
              ['not_sent', 'Conferi na OLX: não foi enviado'],
            ]) {
              const action = node('button', label);
              action.type = 'button';
              action.onclick = () =>
                run(async () => {
                  await api.resolveListing(draft.id, item.profileId, value);
                  $('listingReview').close();
                  await open();
                });
              results.append(action);
            }
            card.append(results);
          }
          const prepare = node('button', 'Abrir na OLX e preencher');
          prepare.type = 'button';
          prepare.disabled =
            !!item.errors.length ||
            ['PUBLISHED', 'SUBMITTED', 'UNCERTAIN', 'CHANGED'].includes(item.delivery?.state);
          prepare.onclick = () =>
            run(async () => {
              prepare.disabled = true;
              $('listingReview').close();
              notice(`Preparando ${item.profileName}…`);
              try {
                const result = await api.prepareListing(draft.id, item.profileId, draft.revision);
                currentPreparation = {
                  id: draft.id,
                  owner: item.profileId,
                  revision: draft.revision,
                };
                $('backListings').hidden = false;
                $('sendListing').hidden = !result.canSubmit;
                $('fillListing').hidden = false;
                $('sendListing').textContent = `Enviar anúncio · ${item.profileName}`;
                document.getElementById('status').textContent = result.message;
              } finally {
                prepare.disabled = false;
                $('backListings').hidden = false;
              }
            });
          card.append(prepare);
          return card;
        }),
      );
      $('listingReview').showModal();
    });
  const batchLabels = {
    QUEUED: 'Na fila',
    RUNNING: 'Publicando',
    SUBMITTED: 'Enviado à OLX',
    PUBLISHED: 'Publicado',
    NEEDS_ACTION: 'Precisa de atenção',
    UNCERTAIN: 'Confira o envio',
    ERROR: 'Erro',
    CANCELLED: 'Cancelado',
  };
  let batchWasRunning = false;
  function renderBatch(state) {
    $('listingBatch').hidden = !state;
    if (!state) return;
    if (state.running && !batchWasRunning) $('listingBatch').open = false;
    batchWasRunning = state.running;
    const sent = state.jobs.filter((job) => ['SUBMITTED', 'PUBLISHED'].includes(job.status)).length;
    const attention = state.jobs.filter((job) =>
      ['NEEDS_ACTION', 'UNCERTAIN', 'ERROR'].includes(job.status),
    ).length;
    const finished = state.jobs.filter((job) => !['QUEUED', 'RUNNING'].includes(job.status)).length;
    $('listingBatchTitle').textContent =
      `${state.running ? 'Publicação em andamento' : 'Publicação concluída'} · ${finished}/${state.jobs.length} contas · ${sent} enviadas/publicadas` +
      (attention ? ` · ${attention} precisam de atenção` : '');
    $('cancelListingBatch').hidden = !state.running;
    $('cancelListingBatch').disabled = state.cancelled;
    $('listingBatchJobs').replaceChildren(
      ...state.jobs.map((job) => {
        const row = node('div', undefined, 'listing-batch-job');
        row.append(
          node('strong', job.name + ' · ' + batchLabels[job.status]),
          node('p', job.message),
        );
        if (job.url) row.append(node('span', job.url));
        return row;
      }),
    );
    for (const element of document.querySelectorAll(
      '#listingWorkspace input,#listingWorkspace textarea,#listingWorkspace select,#listingWorkspace button',
    )) {
      if (['cancelListingBatch'].includes(element.id)) continue;
      if (state.running) {
        if (!element.disabled) element.dataset.batchDisabled = 'true';
        element.disabled = true;
      } else if (element.dataset.batchDisabled) {
        element.disabled = false;
        delete element.dataset.batchDisabled;
      }
    }
    if (!state.running) updateReviewButton();
  }
  api.onListingBatch(renderBatch);
  api
    .listingBatch()
    .then(renderBatch)
    .catch(() => {});
  $('cancelListingBatch').onclick = () =>
    run(async () => renderBatch(await api.cancelListingBatch()));
  async function publishSaved(id) {
    await save();
    const latest = await api.listListings();
    const selected = latest.drafts.find((d) => d.id === id);
    if (!selected) throw new Error('Rascunho não encontrado.');
    const state = await api.publishListings(id, selected.revision);
    renderBatch(state);
    return state;
  }
  $('reviewListing').onclick = () =>
    run(async () => {
      await save();
      const review = await api.reviewListing(draft.id, draft.revision);
      const invalid = review.find((item) => item.errors.length);
      if (invalid) throw new Error(invalid.profileName + ': complete ' + invalid.errors.join(', '));
      renderBatch(await api.publishListings(draft.id, draft.revision));
    });
  $('closeListingReview').onclick = () => $('listingReview').close();
  $('fillListing').onclick = () =>
    run(async () => {
      if (!currentPreparation) return;
      $('fillListing').disabled = true;
      try {
        const result = await api.fillListing(
          currentPreparation.id,
          currentPreparation.owner,
          currentPreparation.revision,
        );
        $('sendListing').hidden = !result.canSubmit;
        $('status').textContent = result.message;
      } catch (error) {
        $('status').textContent = error.message;
        throw error;
      } finally {
        $('fillListing').disabled = false;
      }
    });
  $('sendListing').onclick = () =>
    run(async () => {
      if (!currentPreparation) return;
      $('sendListing').disabled = true;
      try {
        const result = await api.submitListing(
          currentPreparation.id,
          currentPreparation.owner,
          currentPreparation.revision,
        );
        document.getElementById('status').textContent =
          result.message || 'Envio solicitado. Confira o resultado na OLX antes de repetir.';
        $('sendListing').hidden = true;
      } catch (error) {
        document.getElementById('status').textContent = error.message;
        throw error;
      } finally {
        $('sendListing').disabled = false;
      }
    });
  // Maintenance recovery uses the same trusted IPC and visible UI as normal preparation.
  async function prepareSaved(id, owner, confirmedUnsent = false) {
    await save();
    data = await api.listings();
    const selected = data.drafts.find((d) => d.id === id);
    if (!selected || !selected.targets.includes(owner))
      throw new Error('Rascunho ou conta inválida.');
    loadDraft(selected);
    if (confirmedUnsent) await api.resolveListing(id, owner, 'not_sent');
    currentPreparation = { id, owner, revision: draft.revision };
    $('backListings').hidden = false;
    $('sendListing').hidden = true;
    $('fillListing').hidden = false;
    $('status').textContent = 'Preparando anúncio salvo…';
    const result = await api.prepareListing(id, owner, draft.revision);
    $('sendListing').hidden = !result.canSubmit;
    $('sendListing').textContent =
      `Enviar anúncio · ${data.profiles.find((p) => p.id === owner).name}`;
    $('status').textContent = result.message;
    return result;
  }
  async function setFacts(id, value, field = 'details') {
    await save();
    data = await api.listings();
    const selected = data.drafts.find((d) => d.id === id);
    if (!selected) throw new Error('Rascunho inválido.');
    loadDraft(selected);
    draft.base[field] = value;
    changed();
    await save();
    return { saved: true };
  }
  window.multiListings = {
    refreshProfiles: async () => {
      data = await api.listListings();
      const current = data.drafts.find((d) => d.id === draft?.id);
      if (current) loadDraft(current);
    },
    save,
    open,
    prepare: prepareSaved,
    publishSaved,
    setFacts,
    setCondition: (id, value) => setFacts(id, value, 'condition'),
  };
})();
