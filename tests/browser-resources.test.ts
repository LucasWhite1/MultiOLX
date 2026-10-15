import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const { pageLimit, leastRecent } = createRequire(import.meta.url)('../browser/resources.cjs');
const { UnifiedInbox } = createRequire(import.meta.url)('../browser/inbox.cjs');
it('suspende o perfil menos recente sem escolher a conversa em uso ou um login protegido', () => {
  expect(
    leastRecent(
      ['a', 'b', 'c'],
      new Map([
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ]),
      new Set(['a', 'b']),
    ),
  ).toBe('c');
  expect(leastRecent(['a'], new Map(), new Set(['a']))).toBeUndefined();
  expect(pageLimit(2)).toBe(2);
  expect(() => pageLimit(1000)).toThrow();
});
it('restaura resumos com a sessão em espera sem sinalizar falha de conexão', () => {
  const profile = { id: crypto.randomUUID(), name: 'Conta' };
  const row = {
    externalId: 'x',
    url: 'https://chat.olx.com.br/?chat-id=x',
    contact: 'Contato',
    listingTitle: 'Produto',
    preview: 'Olá',
    timeLabel: 'Ontem',
  };
  const inbox = new UnifiedInbox();
  inbox.update(profile.id, { status: 'READY', conversations: [row] });
  inbox.update(profile.id, { status: 'DETAIL' });
  expect(inbox.state([profile]).conversations[0].stale).toBe(false);
  const restored = new UnifiedInbox();
  restored.restore(inbox.export(), [profile]);
  expect(restored.state([profile]).conversations[0]).toMatchObject({
    profileId: profile.id,
    paused: true,
    stale: false,
  });
  expect(restored.state([profile]).accounts[0].status).toBe('PAUSED');
});
