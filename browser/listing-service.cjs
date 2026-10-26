const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ListingCatalog, resolveListing } = require('./listings.cjs');
const { profileId } = require('./policy.cjs');
const {
  inspectListingForm,
  fillListingForm,
  attachListingPhotos,
  submitListingForm,
  advanceListingForm,
  selectFreeListing,
  inspectPublishedListing,
  script,
} = require('./listing-form.cjs');
const { runPool } = require('./publish-pool.cjs');
const { onboardingScript } = require('./listing-onboarding.cjs');
const { prepareListingSteps } = require('./listing-runner.cjs');
const { attributeDocument, fillAttributes } = require('./listing-attributes.cjs');
const { createAdManagement } = require('./ad-management.cjs');
function createListingService(options) {
  const {
    root,
    atomic,
    safeStorage,
    secureStorage,
    ipcMain,
    dialog,
    nativeImage,
    trusted,
    profiles,
    window: windowFor,
    showWorkspace,
    openPublisher,
  } = options;
  const catalog = new ListingCatalog();
  let assets = new Map(),
    queue = Promise.resolve(),
    prepared = null,
    publisherBusy = false;
  let batch = null,
    batchWork = Promise.resolve();
  const workers = new Map();
  const diagnostics = new Map();
  const batchState = () => structuredClone(batch);
  const notifyBatch = () => options.batchChanged?.(batchState());
  const batchActive = () => batch?.running === true;
  const directory = path.join(root, 'listing-photos');
  const file = path.join(root, 'announcements.enc');
  const deletionFile = path.join(root, 'announcement-removals.enc');
  let deletionHistory = [];
  const adManager = createAdManagement({
    profiles,
    workers,
    blocked: () => batchActive() || publisherBusy,
    open: (owner, url) => openPublisher(owner, {}, { background: true, url }),
    journal: async (result) => {
      const entry = { ...result, updatedAt: new Date().toISOString() };
      const next = [...deletionHistory.filter((r) => r.key !== result.key), entry].slice(-500);
      await atomic(deletionFile, encrypted(next));
      deletionHistory = next;
    },
    deleted: (item) =>
      mutate(() => {
        for (const draft of catalog.drafts) {
          const delivery = draft.deliveries[item.owner];
          if (delivery?.url === item.url)
            catalog.delivery(draft.id, item.owner, {
              ...delivery,
              state: 'DELETED',
              message: 'Anúncio excluído na OLX pelo MultiOLX.',
            });
        }
      }),
  });
  function encrypted(value) {
    if (!secureStorage()) throw new Error('O cofre do sistema está indisponível.');
    return safeStorage.encryptString(JSON.stringify(value));
  }
  async function persist() {
    await atomic(file, encrypted({ drafts: catalog.drafts, assets: [...assets.values()] }));
  }
  function mutate(work) {
    const result = queue
      .catch(() => {})
      .then(async () => {
        const backup = structuredClone(catalog.drafts),
          previousAssets = new Map(assets);
        try {
          const value = await work();
          await persist();
          return structuredClone(value);
        } catch (error) {
          catalog.drafts = backup;
          assets = previousAssets;
          throw error;
        }
      });
    queue = result;
    return result;
  }
  async function restore() {
    try {
      deletionHistory = JSON.parse(safeStorage.decryptString(await fs.readFile(deletionFile)));
      if (!Array.isArray(deletionHistory) || deletionHistory.length > 500)
        throw Error('Histórico inválido.');
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw Error(
          'Não foi possível abrir o histórico de exclusões. Os arquivos foram preservados.',
        );
    }
    try {
      const data = JSON.parse(safeStorage.decryptString(await fs.readFile(file)));
      if (!Array.isArray(data.assets)) throw new Error('Fotos inválidas.');
      for (const asset of data.assets) {
        profileId(asset.id);
        if (
          typeof asset.name !== 'string' ||
          !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mime) ||
          typeof asset.thumbnail !== 'string' ||
          asset.thumbnail.length > 300000
        )
          throw new Error('Foto inválida.');
      }
      assets = new Map(data.assets.map((a) => [a.id, a]));
      catalog.restore(data.drafts, profiles(), new Set(assets.keys()), options.removedProfiles?.());
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error(
          'Não foi possível abrir os rascunhos. Os arquivos existentes foram preservados.',
        );
    }
  }
  function summary() {
    return {
      drafts: structuredClone(catalog.drafts),
      assets: [...assets.values()],
      profiles: profiles(),
    };
  }
  function handle(name, fn) {
    ipcMain.handle(name, async (event, ...args) => {
      trusted(event);
      if (
        adManager.active() &&
        ![
          'listings:managed-state',
          'listings:managed-cancel',
          'listings:show',
          'listings:list',
          'listings:ai-status',
          'listings:batch-state',
        ].includes(name)
      )
        throw Error('Aguarde a consulta ou exclusão de anúncios em andamento.');
      if (
        batchActive() &&
        [
          'listings:prepare',
          'listings:fill',
          'listings:submit',
          'listings:save',
          'listings:create',
          'listings:resolve',
          'listings:photos',
        ].includes(name)
      )
        throw new Error('Aguarde a publicação em andamento ou cancele a fila.');
      const publisher = ['listings:prepare', 'listings:fill', 'listings:submit'].includes(name);
      if (publisher && publisherBusy) throw new Error('Aguarde o preparo da conta atual.');
      if (publisher) publisherBusy = true;
      try {
        return await fn(...args);
      } finally {
        if (publisher) publisherBusy = false;
      }
    });
  }
  handle('listings:show', () => {
    showWorkspace();
    return summary();
  });
  handle('listings:list', summary);
  handle('listings:managed-scan', (owners) => {
    showWorkspace();
    return adManager.scan(owners);
  });
  handle('listings:managed-state', () => ({
    ...adManager.snapshot(),
    history: structuredClone(deletionHistory),
  }));
  handle('listings:managed-review', (keys) => adManager.prepare(keys));
  handle('listings:managed-delete', (token) => adManager.remove(token));
  handle('listings:managed-cancel', () => adManager.cancel());
  handle('listings:ai-status', () => options.ai.status());
  handle('listings:ai-configure', (input) => options.ai.configure(input));
  handle('listings:ai-test', () => options.ai.test());
  handle('listings:create', () => mutate(() => catalog.create()));
  handle('listings:save', (input) =>
    mutate(() => catalog.save(input, profiles(), new Set(assets.keys()))),
  );
  handle('listings:review', async (id, revision) => {
    await queue.catch(() => {});
    const d = catalog.find(id);
    if (d.revision !== revision) throw new Error('Salve e revise a versão atual.');
    return catalog.review(id, profiles()).map((item) => ({
      ...item,
      errors: [
        ...item.errors,
        ...(options.ai?.status().enabled &&
        item.listing.group === 'Produtos' &&
        !item.listing.condition
          ? ['condição do produto']
          : []),
      ],
    }));
  });
  handle('listings:resolve', async (id, owner, result) =>
    mutate(() => {
      if (!['published', 'not_sent'].includes(result)) throw new Error('Resultado inválido.');
      const d = catalog.find(id),
        entry = d.deliveries[owner];
      if (!entry || !['REVIEW', 'UNCERTAIN'].includes(entry.state))
        throw new Error('Este resultado não pode ser alterado.');
      return catalog.delivery(id, owner, {
        ...entry,
        state: result === 'published' ? 'PUBLISHED' : 'DRAFT',
        message:
          result === 'published'
            ? 'Envio confirmado por você. A situação na OLX não foi consultada automaticamente.'
            : 'Você confirmou que não foi enviado. O preparo foi liberado.',
      });
    }),
  );
  handle('listings:photos', async () => {
    const result = await dialog.showOpenDialog(windowFor(), {
      title: 'Fotos do anúncio',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fotos', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (result.canceled) return [];
    return importPhotos(result.filePaths);
  });
  async function importPhotos(filePaths) {
    if (batchActive()) throw Error('Aguarde a publicação antes de importar fotos.');
    if (filePaths.length > 20) throw new Error('Selecione até 20 fotos por vez.');
    return mutate(async () => {
      const imported = [];
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      for (const source of filePaths) {
        if ((await fs.stat(source)).size > 20 * 1024 * 1024)
          throw new Error('Uma foto excede 20 MB. Escolha uma versão menor.');
        const image = nativeImage.createFromBuffer(await fs.readFile(source));
        const size = image.getSize();
        if (image.isEmpty() || size.width < 50 || size.height < 50)
          throw new Error('Escolha imagens válidas com pelo menos 50 × 50 pixels.');
        const factor = Math.min(1, 1920 / size.width, 1920 / size.height);
        const optimized =
          factor < 1
            ? image.resize({
                width: Math.round(size.width * factor),
                height: Math.round(size.height * factor),
              })
            : image;
        const bytes = optimized.toJPEG(88);
        const outputSize = optimized.getSize();
        if (outputSize.width < 50 || outputSize.height < 50)
          throw new Error('Uma foto é estreita demais após otimização. Escolha outra proporção.');
        if (bytes.length > 5 * 1024 * 1024)
          throw new Error('Uma foto ainda excede 5 MB após otimização.');
        const id = randomUUID();
        const asset = {
          id,
          name: path.basename(source, path.extname(source)).slice(0, 100) + '.jpg',
          mime: 'image/jpeg',
          size: bytes.length,
          thumbnail:
            'data:image/jpeg;base64,' +
            optimized
              .resize({
                width: Math.max(
                  1,
                  Math.round(
                    outputSize.width * Math.min(1, 180 / outputSize.width, 180 / outputSize.height),
                  ),
                ),
                height: Math.max(
                  1,
                  Math.round(
                    outputSize.height *
                      Math.min(1, 180 / outputSize.width, 180 / outputSize.height),
                  ),
                ),
              })
              .toJPEG(65)
              .toString('base64'),
        };
        await atomic(
          path.join(directory, id + '.enc'),
          encrypted({ data: bytes.toString('base64') }),
        );
        assets.set(id, asset);
        imported.push(asset);
      }
      return imported;
    });
  }
  handle('listings:prepare', async (id, owner, revision) => {
    await queue.catch(() => {});
    const draft = catalog.find(id);
    if (draft.revision !== revision) throw new Error('Salve as alterações antes de abrir na OLX.');
    const item = catalog.review(id, profiles()).find((i) => i.profileId === owner);
    if (!item) throw new Error('Selecione essa conta no rascunho.');
    if (
      options.ai?.status().enabled &&
      item.listing.group === 'Produtos' &&
      !item.listing.condition
    )
      throw new Error('Selecione a condição do produto antes de preparar o anúncio.');
    if (item.errors.length) throw new Error('Complete: ' + item.errors.join(', ') + '.');
    if (['PUBLISHED', 'SUBMITTED', 'UNCERTAIN', 'CHANGED'].includes(item.delivery?.state))
      throw new Error(
        'Este anúncio já foi enviado ou precisa ser conferido na OLX. Não será reenviado automaticamente.',
      );
    if (item.delivery?.state === 'REVIEW') {
      if (prepared?.id === id && prepared.owner === owner && !prepared.contents.isDestroyed()) {
        await options.focusPublisher(owner, prepared.contents);
        return fillPrepared(revision);
      }
      throw new Error(
        'Confira o resultado do preparo anterior e registre se foi enviado antes de reabrir.',
      );
    }
    prepared = null;
    const contents = await openPublisher(owner, item.listing);
    prepared = {
      id,
      owner,
      fingerprint: item.fingerprint,
      listing: item.listing,
      contents,
      filled: [],
      photosAttached: false,
    };
    return fillPrepared(revision);
  });
  async function fillPrepared(revision, p = prepared, automatic = false, autoSubmit = automatic) {
    if (!p || p.contents.isDestroyed())
      throw new Error('Abra primeiro o anúncio na conta desejada.');
    if (!automatic && !options.publisherActive(p.owner, p.contents))
      throw new Error('Volte ao formulário da conta correta antes de preencher.');
    const draft = catalog.find(p.id);
    const current = catalog.review(p.id, profiles()).find((i) => i.profileId === p.owner);
    if (draft.revision !== revision || !current || current.fingerprint !== p.fingerprint)
      throw new Error('O rascunho mudou. Prepare a versão atual.');
    if (['PUBLISHED', 'SUBMITTED', 'CHANGED', 'UNCERTAIN'].includes(current.delivery?.state))
      throw new Error('Confira o envio anterior na OLX antes de continuar.');
    const assertActive = () => {
      if (
        p.contents.isDestroyed() ||
        (automatic
          ? batch.cancelled || !workers.has(p.owner)
          : !options.publisherActive(p.owner, p.contents))
      )
        throw new Error('Preparo interrompido: a conta em exibição mudou.');
      const latest = catalog.review(p.id, profiles()).find((i) => i.profileId === p.owner);
      if (latest?.fingerprint !== p.fingerprint)
        throw new Error('O rascunho mudou durante o preenchimento.');
    };
    const execute = async (fn, arg) => {
      assertActive();
      return p.contents.executeJavaScript(script(fn, arg));
    };
    const result = await prepareListingSteps(p, {
      assertActive,
      now: Date.now,
      pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      inspect: () => execute(inspectListingForm),
      category: options.ai?.status().enabled
        ? async (state) => {
            options.publisherStatus?.('DeepSeek: selecionando a categoria do produto…');
            const answer = await options.ai.choose(
              p.listing,
              {
                id: 'listing_category',
                label: 'Categoria do produto',
                current: '',
                options: state.categoryOptions,
              },
              'Escolha uma categoria ou subcategoria da lista que contenha este produto.',
              await photoPayload(p.id, p.owner),
            );
            assertActive();
            if (!options.ai.status().enabled) throw new Error('IA desativada.');
            if (!answer?.option || !answer.compatible) return false;
            return execute(attributeDocument, { action: 'category', option: answer.option });
          }
        : undefined,
      attributes: options.ai?.status().enabled
        ? async (state) => {
            let photos;
            return fillAttributes(p.listing, {
              assertActive: () => {
                assertActive();
                if (!options.ai.status().enabled) throw new Error('IA desativada.');
              },
              progress: (label) => options.publisherStatus?.('DeepSeek: conferindo ' + label + '…'),
              pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
              dom: async (command) => {
                const result = await execute(attributeDocument, command);
                if (command.action === 'close') {
                  assertActive();
                  if (!automatic) p.contents.focus();
                  p.contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
                  p.contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
                }
                return result;
              },
              choose: async (product, field) => {
                photos ||= await photoPayload(p.id, p.owner);
                return options.ai.choose(product, field, state.categoryText, photos);
              },
            });
          }
        : undefined,
      fill: (listing) => execute(fillListingForm, listing),
      photos: async () => execute(attachListingPhotos, await photoPayload(p.id, p.owner)),
      advance: () => execute(advanceListingForm),
      selectFree: () => execute(selectFreeListing),
      onboarding: async () => {
        assertActive();
        return p.contents.executeJavaScript(onboardingScript());
      },
      autoSubmit,
      submit: async () => {
        assertActive();
        await mutate(() =>
          catalog.delivery(p.id, p.owner, {
            state: 'UNCERTAIN',
            fingerprint: p.fingerprint,
            message: 'Envio solicitado. Confira na OLX antes de repetir.',
          }),
        );
        assertActive();
        p.submissionRequested = true;
        let clicked;
        try {
          clicked = await execute(submitListingForm, { ...p.listing, verifiedFields: p.filled });
        } catch {
          return { uncertain: true, reason: 'Envio solicitado. Aguardando confirmação da OLX.' };
        }
        if (!clicked.clicked) {
          p.submissionRequested = false;
          return { reason: clicked.reason };
        }
        const until = Date.now() + 20000;
        do {
          // A cancellation after the click must never cause a second submission.
          if (p.contents.isDestroyed()) break;
          try {
            const state = await p.contents.executeJavaScript(script(inspectListingForm));
            if (state.status === 'SUBMITTED') return { submitted: true, state };
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 300));
        } while (Date.now() < until);
        return {
          uncertain: true,
          reason: 'A OLX ainda não confirmou o envio. Confira Meus anúncios antes de repetir.',
        };
      },
    });
    if (!p.submissionRequested) assertActive();
    const message = result.submitted
      ? 'Envio confirmado pela OLX. Aguarde o processamento em Meus anúncios.'
      : result.reason + (p.aiChanges?.length ? ' IA: ' + p.aiChanges.join(' · ') + '.' : '');
    await mutate(() =>
      catalog.delivery(p.id, p.owner, {
        state: result.submitted
          ? 'SUBMITTED'
          : result.uncertain
            ? 'UNCERTAIN'
            : automatic
              ? 'READY'
              : 'REVIEW',
        fingerprint: p.fingerprint,
        message,
      }),
    );
    return {
      submitted: result.submitted === true,
      uncertain: result.uncertain === true,
      filled: p.filled,
      photos: p.photosAttached,
      message,
      canSubmit: result.canSubmit === true,
      ai: p.aiChanges || [],
      aiReview: p.aiReview || [],
    };
  }
  handle('listings:fill', async (id, owner, revision) => {
    await queue.catch(() => {});
    if (!prepared || prepared.id !== id || prepared.owner !== owner)
      throw new Error('Abra o anúncio na conta correta.');
    return fillPrepared(revision);
  });
  // A second explicit click after native review triggers only the normal OLX send control.
  handle('listings:submit', async (id, owner, revision) => {
    await queue.catch(() => {});
    const d = catalog.find(id),
      item = catalog.review(id, profiles()).find((i) => i.profileId === owner);
    if (
      d.revision !== revision ||
      !item ||
      !prepared ||
      prepared.id !== id ||
      prepared.owner !== owner ||
      prepared.fingerprint !== item.fingerprint ||
      prepared.contents.isDestroyed()
    )
      throw new Error('Prepare novamente a versão atual na conta correta.');
    if (['PUBLISHED', 'SUBMITTED', 'CHANGED', 'UNCERTAIN'].includes(item.delivery?.state))
      throw new Error('Confira o envio anterior na OLX antes de tentar outra publicação.');
    if (!options.publisherActive(owner, prepared.contents))
      throw new Error('O formulário precisa estar aberto na conta correta para enviar.');
    const state = await prepared.contents.executeJavaScript(`(${inspectListingForm.toString()})()`);
    if (!state.canSubmit) throw new Error('Complete e confira os campos no formulário da OLX.');
    if (
      state.status === 'OFFERS' &&
      (!prepared.photosAttached ||
        ![
          'title',
          'description',
          'price',
          ...(item.listing.postalCode ? ['postalCode'] : []),
        ].every((key) => prepared.filled.includes(key)))
    )
      throw new Error('Prepare todos os dados deste rascunho antes de finalizar.');
    await mutate(() =>
      catalog.delivery(id, owner, {
        state: 'UNCERTAIN',
        fingerprint: item.fingerprint,
        message:
          'Envio solicitado. Confira o resultado em Meus anúncios na OLX antes de qualquer nova tentativa.',
      }),
    );
    let result;
    try {
      result = await prepared.contents.executeJavaScript(
        script(submitListingForm, { ...item.listing, verifiedFields: prepared.filled }),
      );
    } catch {
      return { clicked: true, uncertain: true };
    }
    if (!result.clicked) {
      await mutate(() =>
        catalog.delivery(id, owner, {
          state: 'REVIEW',
          fingerprint: item.fingerprint,
          message: result.reason,
        }),
      );
      throw new Error(result.reason);
    }
    const until = Date.now() + 10000;
    do {
      if (prepared.contents.isDestroyed()) break;
      try {
        const observed = await prepared.contents.executeJavaScript(script(inspectListingForm));
        if (observed.status === 'SUBMITTED') {
          const message = 'Envio confirmado pela OLX. Aguarde o processamento em Meus anúncios.';
          await mutate(() =>
            catalog.delivery(id, owner, {
              state: 'SUBMITTED',
              fingerprint: item.fingerprint,
              message,
            }),
          );
          return { clicked: true, uncertain: false, message };
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < until);
    return {
      clicked: true,
      uncertain: true,
      message: 'Envio solicitado. Confira o resultado em Meus anúncios antes de repetir.',
    };
  });
  async function photoPayload(id, owner) {
    const draft = catalog.find(id),
      photos = [];
    for (const assetId of resolveListing(draft, owner).photos) {
      const asset = assets.get(assetId);
      if (!asset) throw new Error('Foto ausente.');
      const body = JSON.parse(
        safeStorage.decryptString(await fs.readFile(path.join(directory, assetId + '.enc'))),
      );
      photos.push({ name: asset.name, mime: asset.mime, data: body.data });
    }
    return photos;
  }
  handle('listings:batch-state', batchState);
  handle('listings:batch-cancel', () => {
    if (batchActive()) {
      batch.cancelled = true;
      notifyBatch();
    }
    return batchState();
  });
  async function startBatch(id, revision, prepareOnly = false) {
    await queue.catch(() => {});
    if (batchActive() || publisherBusy || adManager.active())
      throw new Error('Já existe uma operação de anúncios em andamento.');
    if (catalog.find(id).revision !== revision)
      throw new Error('Salve a versão atual antes de publicar.');
    const items = catalog.review(id, profiles());
    if (!items.length) throw new Error('Selecione ao menos uma conta.');
    for (const item of items) {
      if (item.errors.length)
        throw new Error(item.profileName + ': complete ' + item.errors.join(', '));
      if (
        options.ai?.status().enabled &&
        item.listing.group === 'Produtos' &&
        !item.listing.condition
      )
        throw new Error(item.profileName + ': selecione a condição do produto.');
    }
    const concurrency = Math.max(1, Math.min(2, options.parallelLimit?.() || 2));
    batch = {
      id,
      revision,
      running: true,
      cancelled: false,
      concurrency,
      jobs: items.map((i) => ({
        owner: i.profileId,
        name: i.profileName,
        status: 'QUEUED',
        message: 'Na fila',
      })),
    };
    prepared = null;
    showWorkspace();
    notifyBatch();
    const update = (index, status, message, url) => {
      Object.assign(batch.jobs[index], { status, message, url });
      notifyBatch();
    };
    batchWork = runPool(
      items,
      concurrency,
      async (item, index) => {
        const owner = item.profileId;
        workers.set(owner, null);
        let p;
        try {
          update(index, 'RUNNING', 'Conferindo anúncios já publicados…');
          const contents = await openPublisher(owner, item.listing, {
            background: true,
            url: 'https://conta.olx.com.br/anuncios/publicados',
          });
          workers.set(owner, contents);
          if (batch.cancelled) throw new Error('Fila cancelada.');
          const until = Date.now() + 12000;
          let found,
            listLoaded = false;
          do {
            found = await contents.executeJavaScript(script(inspectPublishedListing, item.listing));
            if (found) break;
            if (
              await contents.executeJavaScript(
                `Boolean(document.querySelector('a[href*="/vi/"]')) || /nenhum anúncio|você ainda não|não encontramos anúncios/i.test(document.body?.innerText||'')`,
              )
            ) {
              listLoaded = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 300));
          } while (Date.now() < until && !batch.cancelled);
          if (found) {
            await mutate(() =>
              catalog.delivery(id, owner, {
                state: 'PUBLISHED',
                fingerprint: item.fingerprint,
                url: found.url,
                message: 'Publicado na OLX. ' + found.url,
              }),
            );
            update(index, 'PUBLISHED', 'Já publicado; nenhum novo envio.', found.url);
            return;
          }
          if (batch.cancelled) throw new Error('Fila cancelada.');
          if (!listLoaded)
            throw new Error(
              'A OLX não carregou a lista de publicados. Entre nesta conta e confira antes de publicar.',
            );
          if (
            ['PUBLISHED', 'SUBMITTED', 'UNCERTAIN', 'CHANGED', 'REVIEW'].includes(
              item.delivery?.state,
            )
          ) {
            update(
              index,
              'NEEDS_ACTION',
              item.delivery.message || 'Confira o envio anterior na OLX antes de repetir.',
            );
            return;
          }
          update(index, 'RUNNING', 'Preenchendo anúncio, fotos e opções de entrega…');
          await openPublisher(owner, item.listing, { background: true });
          p = {
            id,
            owner,
            contents,
            listing: item.listing,
            fingerprint: item.fingerprint,
            filled: [],
            photosAttached: false,
          };
          // Persist a known-unsent checkpoint; an interrupted final click is stored separately as UNCERTAIN.
          await mutate(() =>
            catalog.delivery(id, owner, {
              state: 'READY',
              fingerprint: item.fingerprint,
              message: 'Preenchimento automático em andamento; ainda não enviado.',
            }),
          );
          const result = await fillPrepared(revision, p, true, !prepareOnly);
          diagnostics.set(owner, {
            message: result.message,
            ai: result.aiReview,
            url: contents.getURL(),
          });
          update(
            index,
            result.submitted ? 'SUBMITTED' : result.uncertain ? 'UNCERTAIN' : 'NEEDS_ACTION',
            result.message,
          );
        } catch (error) {
          const uncertain = p?.submissionRequested === true;
          if (!uncertain && p) {
            try {
              await mutate(() =>
                catalog.delivery(id, owner, {
                  state: 'READY',
                  fingerprint: item.fingerprint,
                  message: error.message,
                }),
              );
            } catch {
              error = new Error('Falha ao salvar o resultado. Os envios foram interrompidos.');
              batch.cancelled = true;
            }
          }
          update(
            index,
            uncertain ? 'UNCERTAIN' : batch.cancelled ? 'CANCELLED' : 'ERROR',
            uncertain
              ? 'Envio solicitado. Confira o resultado na OLX antes de repetir.'
              : error.message,
          );
        } finally {
          const contents = workers.get(owner);
          if (contents && !contents.isDestroyed()) contents.setBackgroundThrottling(true);
          workers.delete(owner);
        }
      },
      () => batch.cancelled,
    ).finally(() => {
      for (const job of batch.jobs)
        if (job.status === 'QUEUED')
          Object.assign(job, { status: 'CANCELLED', message: 'Cancelado antes de iniciar.' });
      batch.running = false;
      notifyBatch();
    });
    return batchState();
  }
  handle('listings:publish-all', (id, revision) => startBatch(id, revision));
  return {
    removeProfile: (id) =>
      mutate(() => {
        for (const draft of [...catalog.drafts]) {
          if (!draft.targets.includes(id) && !draft.overrides[id] && !draft.deliveries[id])
            continue;
          const overrides = { ...draft.overrides };
          delete overrides[id];
          const saved = catalog.save(
            { ...draft, targets: draft.targets.filter((owner) => owner !== id), overrides },
            profiles(),
            new Set(assets.keys()),
          );
          delete saved.deliveries[id];
        }
        if (prepared?.owner === id) prepared = null;
        return { ok: true };
      }),
    checkBackground: (id) => startBatch(id, catalog.find(id).revision, true),
    diagnostics: () => [...diagnostics],
    photoPayload,
    importPhotos,
    verifyPublished: async (id, owner, contents) => {
      await queue.catch(() => {});
      const item = catalog.review(id, profiles()).find((i) => i.profileId === owner);
      if (!item) throw new Error('Conta não selecionada.');
      const found = await contents.executeJavaScript(script(inspectPublishedListing, item.listing));
      if (!found)
        throw new Error('Não foi possível confirmar este anúncio na lista de publicados.');
      return mutate(() =>
        catalog.delivery(id, owner, {
          state: 'PUBLISHED',
          fingerprint: item.fingerprint,
          url: found.url,
          message: 'Publicado na OLX. ' + found.url,
        }),
      );
    },
    restore,
    summary,
    catalog,
    persist,
    batchState,
    batchActive: () => batchActive() || adManager.active(),
    isWorker: (id) => workers.has(id),
    cancel: () => {
      if (batchActive()) batch.cancelled = true;
      adManager.cancel();
    },
    wait: async () => {
      await batchWork;
      await adManager.wait();
      await queue;
    },
    ownsPage: (id) =>
      workers.has(id) ||
      (prepared?.owner === id &&
        !prepared.contents.isDestroyed() &&
        /^https:\/\/(?:www2|olx-pay|adquirir)\.olx\.com\.br\/(?:desapega|ai|aderir|destaques)(?:[/?#]|$)/.test(
          prepared.contents.getURL(),
        )),
  };
}
module.exports = { createListingService };
