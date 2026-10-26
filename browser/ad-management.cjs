const { randomUUID } = require('node:crypto');
const { adManagementDocument } = require('./ad-management-dom.cjs');
const listUrl = 'https://conta.olx.com.br/anuncios/publicados';
const groupTitle = (s) =>
  s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
function createAdManagement(options) {
  let state = { running: false, phase: 'idle', items: [], accounts: [], results: [] };
  let work = Promise.resolve(),
    review = null,
    cancelled = false;
  const pages = new Map();
  const snapshot = () => structuredClone(state);
  const pause = options.pause || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const call = async (contents, command) => {
    const result = await contents.executeJavaScript(
      `(${adManagementDocument.toString()})(${JSON.stringify(command)})`,
    );
    if (result.error) {
      const error = Error(result.error);
      error.beforeClick = true;
      throw error;
    }
    return result;
  };
  function assertIdle() {
    if (state.running || options.blocked())
      throw Error('Aguarde a publicação ou o gerenciamento de anúncios em andamento.');
  }
  async function pageState(contents, previous) {
    for (let i = 0; i < 100; i++) {
      if (cancelled) throw Error('Operação cancelada.');
      await call(contents, { action: 'dismiss-tour' });
      const result = await call(contents, { action: 'scan' });
      const signature = result.items.map((r) => r.id).join(',');
      if (result.ready && (previous === undefined || signature !== previous)) return result;
      await pause(300);
    }
    throw Error('A lista não carregou completamente. Entre na conta e confira Meus anúncios.');
  }
  async function visit(owner, fn) {
    options.workers.set(owner, null);
    let contents;
    try {
      contents = await options.open(owner, listUrl);
      pages.set(owner, contents);
      options.workers.set(owner, contents);
      return await fn(contents);
    } finally {
      if (contents && !contents.isDestroyed()) contents.setBackgroundThrottling(true);
      options.workers.delete(owner);
    }
  }
  async function walk(contents, inspect) {
    let previous;
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      const page = await pageState(contents, previous);
      const signature = page.items.map((r) => r.id).join(',');
      if (seen.has(signature)) throw Error('Paginação repetida; a consulta foi interrompida.');
      seen.add(signature);
      const result = await inspect(page);
      if (result !== undefined) return result;
      if (!page.next) return;
      previous = signature;
      await call(contents, { action: 'next' });
    }
    throw Error('A lista excedeu 50 páginas. Use Meus anúncios para conferir o restante.');
  }
  function launch(phase, fn) {
    cancelled = false;
    state.running = true;
    state.phase = phase;
    work = Promise.resolve()
      .then(fn)
      .catch((error) => {
        state.error = error.message;
        for (const result of state.results) {
          if (result.status === 'RUNNING') {
            result.status = 'UNCERTAIN';
            result.message = error.message;
          }
          if (result.status === 'QUEUED') {
            result.status = 'CANCELLED';
            result.message = 'Interrompido antes de iniciar.';
          }
        }
      })
      .finally(() => {
        state.running = false;
        state.phase = 'idle';
      });
    return snapshot();
  }
  function scan(owners) {
    assertIdle();
    const profiles = options.profiles();
    if (
      !Array.isArray(owners) ||
      !owners.length ||
      new Set(owners).size !== owners.length ||
      owners.some((id) => !profiles.some((p) => p.id === id))
    )
      throw Error('Selecione contas OLX válidas.');
    review = null;
    state = {
      running: false,
      phase: 'scan',
      items: [],
      accounts: owners.map((id) => ({
        id,
        name: profiles.find((p) => p.id === id).name,
        status: 'QUEUED',
      })),
      results: [],
    };
    return launch('scan', async () => {
      for (const account of state.accounts) {
        if (cancelled) {
          account.status = 'CANCELLED';
          continue;
        }
        account.status = 'RUNNING';
        try {
          await visit(account.id, async (contents) => {
            const items = [];
            await walk(contents, async (page) => {
              account.controls = page.controls || [];
              for (const item of page.items) {
                if (!items.some((r) => r.id === item.id))
                  items.push({
                    ...item,
                    owner: account.id,
                    profileName: account.name,
                    key: account.id + ':' + item.id,
                    group: groupTitle(item.title),
                  });
              }
            });
            state.items.push(...items);
          });
          account.status = 'READY';
        } catch (error) {
          account.status = cancelled ? 'CANCELLED' : 'ERROR';
          account.message = error.message;
        }
      }
    });
  }
  function prepare(keys) {
    assertIdle();
    if (
      !Array.isArray(keys) ||
      !keys.length ||
      keys.length > 500 ||
      new Set(keys).size !== keys.length
    )
      throw Error('Selecione de 1 a 500 anúncios.');
    const items = keys.map((key) => {
      const item = state.items.find((r) => r.key === key);
      if (!item || item.canDelete === false || state.results.some((r) => r.key === key))
        throw Error('Atualize a consulta antes de selecionar este anúncio.');
      return structuredClone(item);
    });
    review = { token: randomUUID(), expires: Date.now() + 10 * 60 * 1000, items };
    return structuredClone(review);
  }
  function remove(token) {
    if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/i.test(token))
      throw Error('Revisão inválida.');
    // An HTTP retry cannot dispatch the same review twice.
    if (state.reviewToken === token) return snapshot();
    assertIdle();
    if (!review || review.token !== token || review.expires < Date.now())
      throw Error('A revisão expirou. Selecione e revise novamente.');
    const items = review.items;
    review = null;
    state.reviewToken = token;
    state.results = items.map((item) => ({ ...item, status: 'QUEUED', message: 'Na fila' }));
    delete state.error;
    return launch('delete', async () => {
      for (const result of state.results) {
        if (cancelled) {
          result.status = 'CANCELLED';
          result.message = 'Cancelado antes de iniciar.';
          continue;
        }
        let submitted = false,
          confirmationAttempted = false,
          nativePhase = 'checking';
        result.status = 'RUNNING';
        result.message = 'Conferindo anúncio na conta…';
        try {
          await visit(result.owner, async (contents) => {
            let found = false;
            await walk(contents, async (page) => {
              if (!page.items.some((r) => r.id === result.id)) return;
              found = true;
              if (cancelled) throw Error('Operação cancelada.');
              await options.journal({
                ...result,
                status: 'UNCERTAIN',
                message: 'Abertura da exclusão solicitada. Confira o resultado na OLX.',
              });
              nativePhase = 'opening';
              await call(contents, { action: 'open-delete', ...result });
              nativePhase = 'opened';
              for (let step = 0; step < 12; step++) {
                if (cancelled) throw Error('Operação cancelada antes da confirmação.');
                await pause(250);
                // Journal before any final confirmation; never automatically retry an uncertain removal.
                await options.journal({
                  ...result,
                  status: 'UNCERTAIN',
                  message: 'Exclusão solicitada. Confira na OLX antes de repetir.',
                });
                confirmationAttempted = true;
                const confirmation = await call(contents, {
                  action: 'confirm-delete',
                  id: result.id,
                });
                if (confirmation.submitted) {
                  submitted = true;
                  break;
                }
              }
              if (!submitted) throw Error('A OLX não confirmou a etapa final de exclusão.');
              for (let i = 0; i < 20; i++) {
                await pause(300);
                if ((await call(contents, { action: 'verify-delete', id: result.id })).deleted)
                  return true;
              }
              throw Error(
                'A OLX ainda não confirmou a exclusão. Confira Meus anúncios antes de repetir.',
              );
            });
            if (!found)
              throw Error('Anúncio não encontrado entre os publicados. Atualize a consulta.');
          });
          result.status = 'DELETED';
          result.message = 'Exclusão confirmada pela OLX.';
          state.items = state.items.filter((r) => r.key !== result.key);
          await options.deleted?.(result);
        } catch (error) {
          result.status =
            submitted ||
            confirmationAttempted ||
            nativePhase === 'opened' ||
            (nativePhase === 'opening' && !error.beforeClick)
              ? 'UNCERTAIN'
              : cancelled
                ? 'CANCELLED'
                : 'ERROR';
          result.message = error.message;
        }
        await options.journal(result);
      }
    });
  }
  return {
    scan,
    prepare,
    remove,
    snapshot,
    open: async (owner) => {
      const contents = pages.get(owner);
      if (!contents || contents.isDestroyed())
        throw Error('A página anterior foi fechada. Consulte os anúncios novamente.');
      await options.focus(owner, contents);
      return { ok: true };
    },
    active: () => state.running,
    wait: () => work,
    cancel: () => {
      cancelled = true;
      return snapshot();
    },
  };
}
module.exports = { createAdManagement, groupTitle };
