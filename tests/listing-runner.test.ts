import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { prepareListingSteps } = createRequire(import.meta.url)('../browser/listing-runner.cjs');
function wizard(pages: any[]) {
  let index = 0,
    time = 0,
    attachedAt = -1,
    free = false,
    advances = 0,
    uploads = 0;
  const p = {
    listing: {
      title: 'iPhone 14',
      description: 'Real',
      price: '1950',
      postalCode: '41347290',
      category: 'Celulares',
    },
    filled: [] as string[],
    photosAttached: false,
  };
  const io = {
    now: () => time,
    pause: async (ms: number) => {
      time += ms;
    },
    assertActive: () => {},
    inspect: async () => {
      const s = pages[index];
      if (s.status === 'WAIT' && time > 1800) {
        index++;
        return pages[index];
      }
      return {
        ...s,
        ...(s.photoInput
          ? {
              photoBusy: attachedAt < 0 || time - attachedAt < 1500,
              canContinue: attachedAt >= 0 && time - attachedAt >= 1500,
            }
          : {}),
        freeSelected: free,
      };
    },
    fill: async () => ({ filled: Object.keys(pages[index].fields || {}) }),
    photos: async () => {
      attachedAt = time;
      uploads++;
      return { attached: true };
    },
    advance: async () => {
      if (pages[index].photoInput && time - attachedAt < 1500) throw new Error('Upload pendente');
      index++;
      advances++;
      return true;
    },
    selectFree: async () => {
      free = true;
      return true;
    },
  };
  return { p, io, stats: () => ({ index, time, advances, uploads, free }) };
}
const field = (...keys: string[]) => ({
  status: 'FORM',
  stage: 'fields',
  fields: Object.fromEntries(keys.map((k) => [k, { id: k }])),
  canContinue: true,
});
it('corrige a condição explícita antes de interromper por campo obrigatório, sem IA', async () => {
  const w = wizard([
    {
      status: 'FORM',
      stage: 'attributes',
      categoryText: 'Furadeiras e Parafusadeiras',
      errors: ['Campo obrigatório'],
      canContinue: true,
    },
    { status: 'SUBMITTED' },
  ]);
  w.p.listing.category = 'parafusadeira';
  let calls = 0;
  Object.assign(w.io, {
    knownAttributes: async () => {
      calls++;
      w.io.inspect = async () => ({
        status: 'FORM',
        stage: 'attributes',
        categoryText: 'Furadeiras e Parafusadeiras Novo',
        errors: [],
        canContinue: true,
      });
      return { changes: ['Condição: Novo'], pending: [] };
    },
  });
  w.io.advance = async () => {
    w.io.inspect = async () => ({ status: 'SUBMITTED' });
    return true;
  };
  const result = await prepareListingSteps(w.p, w.io);
  expect(calls).toBe(1);
  expect(result.submitted).toBe(true);
});
it('conclui entrega e publicação gratuita uma única vez no modo automático', async () => {
  const w = wizard([
    field('title', 'description', 'price', 'postalCode'),
    { status: 'ONBOARDING' },
    { status: 'OFFERS', canSubmit: true },
  ]);
  w.p.photosAttached = true;
  let submits = 0;
  Object.assign(w.io, {
    autoSubmit: true,
    onboarding: async () => {
      await w.io.advance();
      return { progress: true };
    },
    submit: async () => {
      submits++;
      return { submitted: true };
    },
  });
  const result = await prepareListingSteps(w.p, w.io);
  expect(result.submitted).toBe(true);
  expect(submits).toBe(1);
  expect(w.stats().free).toBe(true);
});
it('preserva resultado incerto sem repetir o clique final', async () => {
  const w = wizard([{ status: 'OFFERS', canSubmit: true }]);
  w.p.photosAttached = true;
  w.p.filled = ['title', 'description', 'price', 'postalCode'];
  let submits = 0;
  Object.assign(w.io, {
    autoSubmit: true,
    submit: async () => {
      submits++;
      return { uncertain: true };
    },
  });
  expect((await prepareListingSteps(w.p, w.io)).uncertain).toBe(true);
  expect(submits).toBe(1);
});
it('seleciona a hierarquia de categoria com IA quando a identificação nativa falha', async () => {
  const w = wizard([
    { status: 'CATEGORY', categoryOptions: ['Moda e beleza', 'Celulares'] },
    { status: 'CATEGORY', categoryOptions: ['Beleza e Cuidados Pessoais', 'Roupas'] },
    { status: 'ONBOARDING' },
  ]);
  let calls = 0;
  (w.io as any).category = async () => {
    calls++;
    await w.io.advance();
    return true;
  };
  const result = await prepareListingSteps(w.p, w.io);
  expect(calls).toBe(2);
  expect(result.canSubmit).toBe(false);
  expect(result.state.status).toBe('ONBOARDING');
});
it('usa a IA nas características e reconhece categoria por significado, sem exigir texto idêntico', async () => {
  const page: any = {
    status: 'FORM',
    stage: 'attributes',
    requiredAttributes: 1,
    errors: ['Campo obrigatório'],
    categoryText: 'Moda e beleza / Beleza e Cuidados Pessoais',
    canContinue: true,
  };
  const w = wizard([
    field('title'),
    { status: 'FORM', stage: 'photos', photoInput: true },
    page,
    field('description', 'postalCode'),
    field('price'),
    { status: 'OFFERS', canSubmit: true },
  ]);
  w.p.listing.category = 'perfumes';
  let aiCalls = 0;
  (w.io as any).attributes = async () => {
    aiCalls++;
    page.errors = [];
    page.requiredAttributes = 0;
    return { compatible: true, changes: ['Tipo: Outros'], pending: [] };
  };
  const result = await prepareListingSteps(w.p, w.io);
  expect(result.canSubmit).toBe(true);
  expect(aiCalls).toBe(1);
});
it('retenta somente o avanço intermediário das fotos sem duplicar upload e para nos erros de atributos', async () => {
  const w = wizard([
    { status: 'FORM', stage: 'photos', photoInput: true },
    { status: 'FORM', stage: 'attributes', errors: ['Campo obrigatório'] },
  ]);
  const advance = w.io.advance;
  let clicks = 0;
  w.io.advance = async () => (++clicks === 1 ? true : advance());
  const result = await prepareListingSteps(w.p, w.io);
  expect(clicks).toBe(2);
  expect(w.stats().uploads).toBe(1);
  expect(result.reason).toContain('marca, modelo e condição');
  expect(w.stats().time).toBeLessThan(6000);
});
it('percorre o fluxo observado, aguarda fotos e IA, escolhe grátis e para antes do envio', async () => {
  const w = wizard([
    field('title'),
    { status: 'FORM', stage: 'photos', photoInput: true },
    { status: 'WAIT' },
    {
      status: 'FORM',
      stage: 'attributes',
      categoryText: 'Celulares e Smartphones',
      canContinue: true,
    },
    field('description', 'postalCode'),
    field('price'),
    { status: 'OFFERS', canSubmit: true },
  ]);
  const result = await prepareListingSteps(w.p, w.io);
  expect(result.canSubmit).toBe(true);
  expect(w.p.filled.sort()).toEqual(['description', 'postalCode', 'price', 'title']);
  expect(w.stats()).toMatchObject({ index: 6, uploads: 1, free: true });
});
it('para na identidade e retoma sem adicionar as fotos novamente', async () => {
  const w = wizard([
    field('title'),
    { status: 'FORM', stage: 'photos', photoInput: true },
    field('description', 'postalCode'),
    field('price'),
    { status: 'ONBOARDING' },
  ]);
  const first = await prepareListingSteps(w.p, w.io);
  expect(first.canSubmit).toBe(false);
  expect(first.reason).toContain('dados');
  w.io.inspect = async () => ({ status: 'OFFERS', canSubmit: true, freeSelected: w.stats().free });
  const resumed = await prepareListingSteps(w.p, w.io);
  expect(resumed.canSubmit).toBe(true);
  expect(w.stats().uploads).toBe(1);
});
it('interrompe em categoria divergente, atributos obrigatórios ou troca de conta', async () => {
  for (const extra of [
    { categoryText: 'Imóveis' },
    { categoryText: 'Celulares', requiredAttributes: 1 },
  ]) {
    const w = wizard([{ status: 'FORM', stage: 'attributes', canContinue: true, ...extra }]);
    expect((await prepareListingSteps(w.p, w.io)).canSubmit).toBe(false);
    expect(w.stats().advances).toBe(0);
  }
  const w = wizard([field('title')]);
  w.io.assertActive = () => {
    throw new Error('Conta mudou');
  };
  await expect(prepareListingSteps(w.p, w.io)).rejects.toThrow('Conta mudou');
});
it('não repete avanço quando a página não muda e não libera envio com dados incompletos', async () => {
  const w = wizard([field('title')]);
  w.io.advance = async () => true;
  const stalled = await prepareListingSteps(w.p, w.io);
  expect(stalled.canSubmit).toBe(false);
  expect(w.stats().time).toBeLessThan(27000);
  const incomplete = wizard([{ status: 'OFFERS', canSubmit: true }]);
  expect((await prepareListingSteps(incomplete.p, incomplete.io)).canSubmit).toBe(false);
});
