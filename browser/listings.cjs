const { randomUUID, createHash } = require('node:crypto');
const { profileId } = require('./policy.cjs');
const FIELDS = [
  'title',
  'description',
  'price',
  'postalCode',
  'category',
  'group',
  'details',
  'condition',
];
function normalizePrice(value) {
  const text = value.trim();
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(text)) return text.replaceAll('.', '');
  if (/^\d+(?:[.,]\d{1,2})?$/.test(text)) return text.replace('.', ',');
  return null;
}
function fields(value, partial = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Dados de anúncio inválidos.');
  const limits = {
    title: 90,
    description: 6000,
    price: 14,
    postalCode: 9,
    category: 200,
    group: 100,
    details: 2000,
    condition: 50,
  };
  const result = {};
  for (const key of FIELDS) {
    if (partial && !Object.hasOwn(value, key)) continue;
    const text = value[key] ?? (key === 'group' ? 'Produtos' : '');
    if (typeof text !== 'string' || text.length > limits[key])
      throw new Error(`Campo inválido: ${key}.`);
    result[key] = text;
  }
  if (
    result.group &&
    ![
      'Produtos',
      'Automóveis, Peças e Acessórios',
      'Imóveis',
      'Serviços',
      'Vagas de emprego',
    ].includes(result.group)
  )
    throw new Error('Tipo de anúncio inválido.');
  if (result.price && normalizePrice(result.price) !== null)
    result.price = normalizePrice(result.price);
  if (
    result.condition &&
    ![
      'Novo',
      'Usado - Excelente',
      'Usado - Bom',
      'Recondicionado',
      'Com defeito ou avarias',
    ].includes(result.condition)
  )
    throw new Error('Condição do produto inválida.');
  return result;
}
function resolveListing(draft, owner) {
  const photos = [...draft.photos];
  const index = draft.targets.indexOf(owner);
  if (draft.rotateCover === true && photos.length > 1 && index >= 0) {
    const offset = index % photos.length;
    photos.unshift(...photos.splice(offset, 1));
  }
  return { ...draft.base, ...draft.overrides[owner], photos };
}
function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function readyErrors(value) {
  const missing = [];
  if (value.title.trim().length < 2) missing.push('título');
  if (value.description.trim().length < 2) missing.push('descrição');
  if (
    !value.price ||
    normalizePrice(value.price) === null ||
    !Number.isFinite(Number(value.price.replace(',', '.'))) ||
    Number(value.price.replace(',', '.')) <= 0
  )
    missing.push('preço maior que zero');
  if (value.postalCode && !/^\d{5}-?\d{3}$/.test(value.postalCode))
    missing.push('CEP com 8 dígitos');
  if (!value.photos.length) missing.push('ao menos uma foto');
  const photoLimit = ['Imóveis', 'Automóveis, Peças e Acessórios'].includes(value.group) ? 20 : 6;
  if (value.photos.length > photoLimit)
    missing.push(`no máximo ${photoLimit} fotos para este tipo de anúncio`);
  return missing;
}
class ListingCatalog {
  constructor() {
    this.drafts = [];
  }
  create() {
    const now = new Date().toISOString();
    const draft = {
      id: randomUUID(),
      revision: 1,
      base: fields({}),
      overrides: {},
      targets: [],
      photos: [],
      rotateCover: false,
      deliveries: {},
      createdAt: now,
      updatedAt: now,
    };
    this.drafts.unshift(draft);
    return draft;
  }
  find(id) {
    const draft = this.drafts.find((d) => d.id === profileId(id));
    if (!draft) throw new Error('Rascunho não encontrado.');
    return draft;
  }
  save(input, profiles, assets) {
    const previous = this.find(input?.id);
    if (input.revision !== previous.revision)
      throw new Error('Este rascunho mudou. Reabra-o antes de salvar.');
    const allowed = new Set(profiles.map((p) => p.id));
    if (
      !Array.isArray(input.targets) ||
      input.targets.length > profiles.length ||
      new Set(input.targets).size !== input.targets.length ||
      input.targets.some((id) => !allowed.has(id))
    )
      throw new Error('Seleção de contas inválida.');
    if (
      !Array.isArray(input.photos) ||
      input.photos.length > 20 ||
      new Set(input.photos).size !== input.photos.length ||
      input.photos.some((id) => !assets.has(id))
    )
      throw new Error('Seleção de fotos inválida.');
    const overrides = {};
    if (input.rotateCover !== undefined && typeof input.rotateCover !== 'boolean')
      throw new Error('Opção de alternar foto principal inválida.');
    if (!input.overrides || typeof input.overrides !== 'object' || Array.isArray(input.overrides))
      throw new Error('Variações inválidas.');
    for (const [id, value] of Object.entries(input.overrides)) {
      if (!allowed.has(id)) throw new Error('Conta de variação inválida.');
      overrides[id] = fields(value, true);
    }
    const next = {
      ...previous,
      base: fields(input.base),
      overrides,
      targets: [...input.targets],
      photos: [...input.photos],
      rotateCover: input.rotateCover === true,
      revision: previous.revision + 1,
      updatedAt: new Date().toISOString(),
      deliveries: { ...previous.deliveries },
    };
    for (const [id, result] of Object.entries(next.deliveries)) {
      const same = result.fingerprint === fingerprint(resolveListing(next, id));
      if (!same)
        next.deliveries[id] = {
          ...result,
          state:
            result.state === 'UNCERTAIN'
              ? 'UNCERTAIN'
              : ['PUBLISHED', 'SUBMITTED', 'CHANGED'].includes(result.state)
                ? 'CHANGED'
                : 'DRAFT',
          message: ['PUBLISHED', 'SUBMITTED'].includes(result.state)
            ? 'O conteúdo local mudou; o anúncio já publicado não foi alterado.'
            : 'Conteúdo alterado; prepare novamente.',
        };
    }
    this.drafts[this.drafts.indexOf(previous)] = next;
    return next;
  }
  review(id, profiles) {
    const draft = this.find(id);
    return draft.targets.map((owner) => {
      const profile = profiles.find((p) => p.id === owner);
      if (!profile) throw new Error('Conta selecionada não encontrada.');
      const listing = resolveListing(draft, owner);
      return {
        profileId: owner,
        profileName: profile.name,
        listing,
        errors: readyErrors(listing),
        fingerprint: fingerprint(listing),
        delivery: draft.deliveries[owner] || null,
      };
    });
  }
  delivery(id, owner, result) {
    const draft = this.find(id);
    profileId(owner);
    if (!draft.targets.includes(owner)) throw new Error('Conta não selecionada.');
    draft.deliveries[owner] = { ...result, updatedAt: new Date().toISOString() };
    return draft.deliveries[owner];
  }
  restore(data, profiles, assets, removedIds = []) {
    if (!Array.isArray(data) || data.length > 500)
      throw new Error('Catálogo de anúncios inválido.');
    const restored = new ListingCatalog();
    for (const original of data) {
      const removed = new Set(removedIds);
      const entry = removed.size
        ? {
            ...original,
            targets: original.targets.filter((id) => !removed.has(id)),
            overrides: Object.fromEntries(
              Object.entries(original.overrides).filter(([id]) => !removed.has(id)),
            ),
          }
        : original;
      profileId(entry.id);
      if (restored.drafts.some((d) => d.id === entry.id)) throw new Error('Rascunho duplicado.');
      const revision = Number.isInteger(entry.revision) && entry.revision > 0 ? entry.revision : 1;
      restored.drafts.push({ ...entry, revision, deliveries: {} });
      const saved = restored.save({ ...entry, revision }, profiles, assets);
      saved.revision = revision;
      saved.deliveries = {};
      for (const [owner, result] of Object.entries(entry.deliveries || {})) {
        if (
          !profiles.some((p) => p.id === owner) ||
          !result ||
          typeof result.fingerprint !== 'string'
        )
          continue;
        const state = [
          'PUBLISHED',
          'SUBMITTED',
          'CHANGED',
          'READY',
          'DRAFT',
          'ERROR',
          'UNCERTAIN',
        ].includes(result.state)
          ? result.state
          : 'UNCERTAIN';
        saved.deliveries[owner] = {
          state,
          fingerprint: result.fingerprint,
          message:
            result.state === 'REVIEW'
              ? 'Preparo de uma execução anterior. Confira na OLX se houve envio antes de reabrir.'
              : typeof result.message === 'string'
                ? result.message.slice(0, 1000)
                : '',
          url:
            typeof result.url === 'string' &&
            /^https:\/\/(?:[a-z0-9-]+\.)*olx\.com\.br\//i.test(result.url)
              ? result.url
              : null,
          updatedAt: typeof result.updatedAt === 'string' ? result.updatedAt : null,
        };
      }
    }
    this.drafts = restored.drafts;
  }
}
module.exports = { ListingCatalog, resolveListing, fingerprint, readyErrors, FIELDS };
