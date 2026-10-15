import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const { UnifiedInbox, validateRows } = createRequire(import.meta.url)('../browser/inbox.cjs');
const profiles = [
  { id: crypto.randomUUID(), name: 'A' },
  { id: crypto.randomUUID(), name: 'B' },
];
const row = {
  externalId: 'same%3D@conference.olxbr',
  url: 'https://chat.olx.com.br/?chat-id=same%3D@conference.olxbr',
  contact: 'Contato',
  listingTitle: 'Produto',
  preview: 'Olá',
  timeLabel: '12:00',
};
it('mantém a origem de conversas iguais em duas contas e aceita caixa vazia sem remover outra conta', () => {
  const inbox = new UnifiedInbox();
  for (const p of profiles) inbox.update(p.id, { status: 'READY', conversations: [row] }, 100);
  const state = inbox.state(profiles);
  expect(state.conversations).toHaveLength(2);
  expect(new Set(state.conversations.map((c: any) => c.key)).size).toBe(2);
  for (const c of state.conversations)
    expect(inbox.find(c.key, profiles).profileId).toBe(c.profileId);
  inbox.update(profiles[0].id, { status: 'READY', conversations: [] }, 200);
  expect(inbox.state(profiles).conversations.map((c: any) => c.profileId)).toEqual([
    profiles[1].id,
  ]);
});
it('preserva a última lista em falha, não inventa mensagens e destaca alterações observadas', () => {
  const inbox = new UnifiedInbox();
  inbox.update(profiles[0].id, { status: 'READY', conversations: [row] }, 100);
  inbox.update(profiles[0].id, { status: 'BLOCKED' }, 200);
  expect(inbox.state(profiles).conversations[0]).toMatchObject({ preview: 'Olá', stale: true });
  inbox.update(
    profiles[0].id,
    { status: 'READY', conversations: [{ ...row, preview: 'Atualização' }] },
    300,
  );
  expect(inbox.state(profiles).conversations[0]).toMatchObject({
    changedAt: 300,
    preview: 'Atualização',
    stale: false,
  });
  expect(inbox.state(profiles).conversations[0]).not.toHaveProperty('messages');
});
it('recusa links externos e identificadores duplicados sem alterar a lista válida', () => {
  expect(() => validateRows([{ ...row, url: 'https://evil.test/' }])).toThrow();
  expect(() => validateRows([row, row])).toThrow();
  const inbox = new UnifiedInbox();
  inbox.update(profiles[0].id, { status: 'READY', conversations: [row] });
  expect(() =>
    inbox.update(profiles[0].id, {
      status: 'READY',
      conversations: [{ ...row, url: 'https://evil.test/' }],
    }),
  ).toThrow();
  expect(inbox.state(profiles).conversations).toHaveLength(1);
});
it('distingue não lida, visualizada sem resposta e última enviada por você, sem inventar quantidade', () => {
  const inbox = new UnifiedInbox();
  const id = profiles[0].id;
  const current = () => inbox.state(profiles).conversations[0];
  inbox.update(id, { status: 'READY', conversations: [{ ...row, unread: true }] });
  expect(current()).toMatchObject({
    attention: 'unread',
    unreadCount: null,
    lastDirection: 'unknown',
  });
  inbox.update(id, {
    status: 'READY',
    conversations: [{ ...row, unread: false }],
    detail: { externalId: row.externalId, preview: 'Olá', lastDirection: 'incoming', viewed: true },
  });
  expect(current()).toMatchObject({ attention: 'awaiting', unread: false });
  inbox.update(id, { status: 'READY', conversations: [{ ...row, unread: false }] });
  expect(current().attention).toBe('awaiting');
  inbox.update(id, {
    status: 'READY',
    conversations: [{ ...row, preview: 'Resposta', timeLabel: '12:01', unread: false }],
    detail: { externalId: row.externalId, preview: 'Resposta', lastDirection: 'outgoing' },
  });
  expect(current().attention).toBe('outgoing');
  inbox.update(id, { status: 'READY', conversations: [{ ...row, preview: 'Nova', unread: true }] });
  expect(current()).toMatchObject({ attention: 'unread', lastDirection: 'unknown' });
});
it('não marca lida por clique ou pelo detalhe antigo, nem transfere autoria entre contas', () => {
  const inbox = new UnifiedInbox();
  for (const p of profiles)
    inbox.update(p.id, { status: 'READY', conversations: [{ ...row, unread: true }] });
  inbox.update(profiles[0].id, { status: 'OPENING' });
  expect(inbox.find(`${profiles[0].id}:${row.externalId}`, profiles).attention).toBe('unread');
  inbox.update(profiles[0].id, {
    status: 'DETAIL',
    detail: {
      externalId: row.externalId,
      preview: 'Antiga',
      lastDirection: 'outgoing',
      viewed: true,
    },
  });
  expect(inbox.find(`${profiles[0].id}:${row.externalId}`, profiles).attention).toBe('unread');
  inbox.update(profiles[0].id, {
    status: 'DETAIL',
    detail: { externalId: row.externalId, preview: 'Olá', lastDirection: 'outgoing', viewed: true },
  });
  expect(inbox.find(`${profiles[0].id}:${row.externalId}`, profiles).attention).toBe('outgoing');
  expect(inbox.find(`${profiles[1].id}:${row.externalId}`, profiles).attention).toBe('unread');
  const restored = new UnifiedInbox();
  restored.restore(inbox.export(), profiles);
  expect(restored.find(`${profiles[0].id}:${row.externalId}`, profiles).attention).toBe('outgoing');
});
it('mantém estado desconhecido sem evidência e descarta contagens inválidas', () => {
  const inbox = new UnifiedInbox();
  inbox.update(profiles[0].id, { status: 'READY', conversations: [row] });
  expect(inbox.state(profiles).conversations[0].attention).toBe('unknown');
  expect(validateRows([{ ...row, unread: true, unreadCount: -1 }])[0].unreadCount).toBeNull();
});
it('reconhece a autoria quando o roteador da OLX normaliza a codificação do identificador', () => {
  const inbox = new UnifiedInbox();
  inbox.update(profiles[0].id, { status: 'READY', conversations: [{ ...row, unread: false }] });
  inbox.update(profiles[0].id, {
    status: 'DETAIL',
    detail: { chatId: 'same=@conference.olxbr', preview: row.preview, lastDirection: 'outgoing' },
  });
  expect(inbox.state(profiles).conversations[0].attention).toBe('outgoing');
});
it('invalida a autoria anterior ao aparecer uma nova não lida com texto e horário repetidos', () => {
  const inbox = new UnifiedInbox();
  inbox.update(
    profiles[0].id,
    { status: 'READY', conversations: [{ ...row, unread: false, lastDirection: 'outgoing' }] },
    100,
  );
  inbox.update(profiles[0].id, { status: 'READY', conversations: [{ ...row, unread: true }] }, 200);
  expect(inbox.state(profiles).conversations[0]).toMatchObject({
    attention: 'unread',
    lastDirection: 'unknown',
    changedAt: 200,
  });
});
