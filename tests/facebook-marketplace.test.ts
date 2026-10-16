import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const { validateRows, UnifiedInbox } = createRequire(import.meta.url)('../browser/inbox.cjs');
const row = {
  externalId: '123',
  url: 'https://www.facebook.com/messages/t/123/',
  contact: 'Cliente',
  listingTitle: 'Produto',
  preview: 'Você: Disponível',
  timeLabel: 'Agora',
  unread: false,
  lastDirection: 'outgoing',
  platform: 'facebook-marketplace',
};
it('aceita chave local apenas com a URL exata da caixa Marketplace', () => {
  const externalId = 'marketplace-buy-' + 'a'.repeat(64);
  const local = {
    ...row,
    externalId,
    url: 'https://www.facebook.com/marketplace/inbox/?multiolx-thread=' + externalId,
  };
  expect(validateRows([local])[0].externalId).toBe(externalId);
  expect(() => validateRows([{ ...local, url: local.url + '&extra=1' }])).toThrow();
});
it('aceita apenas linhas explicitamente identificadas como Marketplace e URLs correspondentes', () => {
  expect(validateRows([row])[0].platform).toBe('facebook-marketplace');
  expect(() => validateRows([{ ...row, platform: undefined }])).toThrow();
  expect(() =>
    validateRows([{ ...row, url: 'https://www.facebook.com/messages/t/999/' }]),
  ).toThrow();
  expect(() => validateRows([{ ...row, url: row.url + '?injetado=1' }])).toThrow();
  expect(() =>
    validateRows([{ ...row, url: 'https://facebook.com.evil.test/messages/t/123/' }]),
  ).toThrow();
});
it('preserva Marketplace, conta de origem, autoria e não lidas ao salvar e restaurar', () => {
  const profiles = [
    { id: crypto.randomUUID(), name: 'Facebook Marketplace', provider: 'facebook' },
  ];
  const inbox = new UnifiedInbox();
  inbox.update(profiles[0].id, { status: 'READY', conversations: [row] });
  expect(inbox.state(profiles).conversations[0]).toMatchObject({
    platform: 'facebook-marketplace',
    attention: 'outgoing',
  });
  const restored = new UnifiedInbox();
  restored.restore(inbox.export(), profiles);
  expect(restored.state(profiles).conversations[0].platform).toBe('facebook-marketplace');
  restored.update(profiles[0].id, {
    status: 'READY',
    conversations: [{ ...row, unread: true, preview: 'Cliente: Olá', lastDirection: 'incoming' }],
  });
  expect(restored.state(profiles).conversations[0].attention).toBe('unread');
});
