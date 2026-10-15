import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const { ListingCatalog, resolveListing } = createRequire(import.meta.url)(
  '../browser/listings.cjs',
);
const profiles = [
  { id: crypto.randomUUID(), name: 'A' },
  { id: crypto.randomUUID(), name: 'B' },
];
it.each([
  [2, 2, [0, 1]],
  [2, 4, [0, 1, 0, 1]],
  [10, 3, [0, 1, 2]],
  [1, 3, [0, 0, 0]],
  [0, 2, []],
])('distribui %i fotos entre %i contas sem perder fotos', (photoCount, accountCount, covers) => {
  const catalog = new ListingCatalog();
  const accounts = Array.from({ length: accountCount }, (_, i) => ({
    id: crypto.randomUUID(),
    name: `Conta ${i}`,
  }));
  const photos = Array.from({ length: photoCount }, () => crypto.randomUUID());
  const saved = catalog.save(
    {
      ...catalog.create(),
      photos,
      targets: accounts.map((p) => p.id),
      rotateCover: true,
    },
    accounts,
    new Set(photos),
  );
  const listings = catalog.review(saved.id, accounts).map((item: any) => item.listing);
  expect(listings.flatMap((listing: any) => listing.photos.slice(0, 1))).toEqual(
    covers.map((index) => photos[index]),
  );
  for (const listing of listings) {
    expect(new Set(listing.photos)).toEqual(new Set(photos));
    expect(listing.photos).toHaveLength(photos.length);
    expect(resolveListing(saved, accounts[listings.indexOf(listing)].id)).toEqual(listing);
  }
  expect(saved.photos).toEqual(photos);
});
it('mantém a opção desligada em rascunhos antigos, persiste a escolha e invalida o preparo afetado', () => {
  const { catalog, draft } = setup();
  const photos = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  let saved = catalog.save({ ...draft, photos, rotateCover: undefined }, profiles, new Set(photos));
  expect(saved.rotateCover).toBe(false);
  expect(resolveListing(saved, profiles[1].id).photos).toEqual(photos);
  catalog.delivery(saved.id, profiles[1].id, {
    state: 'READY',
    fingerprint: catalog.review(saved.id, profiles)[1].fingerprint,
  });
  saved = catalog.save({ ...saved, rotateCover: true }, profiles, new Set(photos));
  expect(saved.deliveries[profiles[1].id].state).toBe('DRAFT');
  const restored = new ListingCatalog();
  restored.restore(catalog.drafts, profiles, new Set(photos));
  expect(restored.find(saved.id).rotateCover).toBe(true);
  expect(resolveListing(restored.find(saved.id), profiles[1].id).photos).toEqual([
    photos[1],
    photos[0],
    photos[2],
  ]);
  expect(() => catalog.save({ ...saved, rotateCover: 'false' }, profiles, new Set(photos))).toThrow(
    'foto principal',
  );
  saved = catalog.save({ ...saved, rotateCover: false }, profiles, new Set(photos));
  expect(resolveListing(saved, profiles[1].id).photos).toEqual(photos);
});
it('herda a condição do produto e permite variação por conta sem aceitar valores inventados', () => {
  const { catalog, draft } = setup();
  const saved = catalog.save(
    {
      ...draft,
      base: { ...draft.base, condition: 'Novo' },
      overrides: { [profiles[1].id]: { condition: 'Usado - Excelente' } },
    },
    profiles,
    new Set(),
  );
  expect(resolveListing(saved, profiles[0].id).condition).toBe('Novo');
  expect(resolveListing(saved, profiles[1].id).condition).toBe('Usado - Excelente');
  expect(() =>
    catalog.save(
      { ...saved, base: { ...saved.base, condition: 'Condição inventada' } },
      profiles,
      new Set(),
    ),
  ).toThrow('Condição');
});
it('preserva envio confirmado ao reiniciar e bloqueia novo preparo quando o conteúdo muda', () => {
  const { catalog, draft } = setup();
  const item = catalog.review(draft.id, profiles)[0];
  catalog.delivery(draft.id, profiles[0].id, {
    state: 'SUBMITTED',
    fingerprint: item.fingerprint,
    message: 'Envio confirmado pela OLX.',
  });
  const restored = new ListingCatalog();
  restored.restore(catalog.drafts, profiles, new Set());
  const current = restored.find(draft.id);
  expect(current.deliveries[profiles[0].id].state).toBe('SUBMITTED');
  const changed = restored.save(
    { ...current, base: { ...current.base, title: 'Novo título' } },
    profiles,
    new Set(),
  );
  expect(changed.deliveries[profiles[0].id].state).toBe('CHANGED');
});
function setup() {
  const catalog = new ListingCatalog();
  const draft = catalog.create();
  draft.base = {
    title: 'Celular',
    description: 'Descrição compartilhada',
    price: '1500',
    postalCode: '90000-000',
    category: 'Celulares',
  };
  draft.targets = profiles.map((p) => p.id);
  return { catalog, draft };
}
it('compartilha todos os campos e mantém apenas as variações explícitas, permitindo voltar à base', () => {
  const { catalog, draft } = setup();
  let next = catalog.save(
    { ...draft, overrides: { [profiles[1].id]: { price: '1400', description: 'Versão B' } } },
    profiles,
    new Set(),
  );
  next = catalog.save(
    { ...next, base: { ...next.base, title: 'Novo título', description: 'Descrição nova' } },
    profiles,
    new Set(),
  );
  expect(resolveListing(next, profiles[0].id)).toMatchObject({
    title: 'Novo título',
    description: 'Descrição nova',
    price: '1500',
  });
  expect(resolveListing(next, profiles[1].id)).toMatchObject({
    title: 'Novo título',
    description: 'Versão B',
    price: '1400',
  });
  next = catalog.save({ ...next, overrides: {} }, profiles, new Set());
  expect(resolveListing(next, profiles[1].id).description).toBe('Descrição nova');
});
it('não confunde conta não selecionada, mantém ordem das fotos e recusa revisão antiga', () => {
  const { catalog, draft } = setup();
  const photos = [crypto.randomUUID(), crypto.randomUUID()];
  const next = catalog.save(
    { ...draft, photos, targets: [profiles[1].id] },
    profiles,
    new Set(photos),
  );
  expect(catalog.review(next.id, profiles).map((x: any) => x.profileId)).toEqual([profiles[1].id]);
  expect(resolveListing(next, profiles[1].id).photos).toEqual(photos);
  expect(() => catalog.save(draft, profiles, new Set())).toThrow('mudou');
  expect(() => catalog.delivery(next.id, profiles[0].id, { state: 'READY' })).toThrow(
    'selecionada',
  );
});
it('restaura variações e resultados sem reenfileirar envios incertos e preserva anúncios já publicados ao editar', () => {
  const { catalog, draft } = setup();
  const item = catalog.review(draft.id, profiles)[0];
  catalog.delivery(draft.id, profiles[0].id, {
    state: 'UNCERTAIN',
    fingerprint: item.fingerprint,
    message: 'Confira na OLX',
  });
  const restored = new ListingCatalog();
  restored.restore(catalog.drafts, profiles, new Set());
  expect(restored.review(draft.id, profiles)[0].delivery.state).toBe('UNCERTAIN');
  catalog.delivery(draft.id, profiles[0].id, { state: 'PUBLISHED', fingerprint: item.fingerprint });
  const next = catalog.save(
    { ...draft, base: { ...draft.base, price: '1600' } },
    profiles,
    new Set(),
  );
  expect(next.deliveries[profiles[0].id].state).toBe('CHANGED');
});
it('recusa fotos e perfis estranhos, valida preço/CEP e mostra pendências sem bloquear rascunhos vazios', () => {
  const { catalog, draft } = setup();
  expect(() => catalog.save({ ...draft, targets: ['../Chrome'] }, profiles, new Set())).toThrow();
  expect(() =>
    catalog.save({ ...draft, photos: [crypto.randomUUID()] }, profiles, new Set()),
  ).toThrow();
  let next = catalog.save(
    { ...draft, base: { ...draft.base, price: '1.500,00' } },
    profiles,
    new Set(),
  );
  expect(next.base.price).toBe('1500,00');
  next = catalog.save(
    { ...next, base: { ...next.base, postalCode: '123', price: '1500,' } },
    profiles,
    new Set(),
  );
  expect(catalog.review(draft.id, profiles)[0].errors).toEqual([
    'preço maior que zero',
    'CEP com 8 dígitos',
    'ao menos uma foto',
  ]);
});
it('não libera um envio incerto ao editar o conteúdo e pede conferência de preparos de outra execução', () => {
  const { catalog, draft } = setup();
  const item = catalog.review(draft.id, profiles)[0];
  catalog.delivery(draft.id, profiles[0].id, { state: 'UNCERTAIN', fingerprint: item.fingerprint });
  const next = catalog.save(
    { ...draft, base: { ...draft.base, title: 'Novo texto' } },
    profiles,
    new Set(),
  );
  expect(next.deliveries[profiles[0].id].state).toBe('UNCERTAIN');
  catalog.delivery(draft.id, profiles[1].id, {
    state: 'REVIEW',
    fingerprint: catalog.review(draft.id, profiles)[1].fingerprint,
  });
  const restored = new ListingCatalog();
  restored.restore(catalog.drafts, profiles, new Set());
  expect(restored.find(draft.id).deliveries[profiles[1].id].state).toBe('UNCERTAIN');
});
