import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { messageTime } = require('../browser/message-time.cjs');
const { UnifiedInbox } = require('../browser/inbox.cjs');
const now = new Date(2026, 9, 16, 12, 30).getTime();
it('interpreta datas brasileiras, anos relativos, ontem e horários com virada do dia', () => {
  expect(messageTime('30/10/2022', now)).toBe(new Date(2022, 9, 30).getTime());
  expect(messageTime('8/4/2025', now)).toBe(new Date(2025, 3, 8).getTime());
  expect(messageTime('3 anos', now)).toBe(new Date(2023, 9, 16, 12, 30).getTime());
  expect(messageTime('Ontem', now)).toBe(new Date(2026, 9, 15).getTime());
  expect(messageTime('23:50', now)).toBe(new Date(2026, 9, 15, 23, 50).getTime());
  expect(messageTime('2 min', now)).toBe(now - 120000);
  expect(messageTime('31/02/2025', now)).toBeNull();
  expect(messageTime('desconhecido', now)).toBeNull();
});
const row = (externalId: string, timeLabel: string) => ({
  externalId,
  timeLabel,
  url: `https://www.facebook.com/messages/t/${externalId}/`,
  contact: 'Contato',
  listingTitle: 'Anúncio',
  preview: 'Olá',
  platform: 'facebook-marketplace',
});
const profiles = [
  { id: 'facebook', name: 'Facebook' },
  { id: 'olx', name: 'OLX' },
];
it('ordena por data da mensagem entre contas, sem promover histórico importado depois ou prévias atualizadas', () => {
  const inbox = new UnifiedInbox();
  inbox.update(
    'olx',
    {
      status: 'READY',
      conversations: [
        { ...row('9', '12:00'), platform: undefined, url: 'https://chat.olx.com.br/?chat-id=9' },
      ],
    },
    now,
  );
  inbox.update('facebook', { status: 'READY', conversations: [row('1', '8/4/2025')] }, now);
  inbox.update(
    'facebook',
    {
      status: 'READY',
      conversations: [row('1', '8/4/2025'), row('2', '3 anos'), row('3', '30/10/2022')],
    },
    now + 1000,
  );
  inbox.update(
    'facebook',
    {
      status: 'READY',
      conversations: [
        row('1', '8/4/2025'),
        row('2', '3 anos'),
        { ...row('3', '30/10/2022'), preview: 'Prévia atualizada', unread: true },
      ],
    },
    now + 2000,
  );
  expect(inbox.state(profiles).conversations.map((r: any) => r.externalId)).toEqual([
    '9',
    '1',
    '2',
    '3',
  ]);
  const restored = new UnifiedInbox();
  restored.restore(inbox.export(), profiles);
  expect(restored.state(profiles).conversations.map((r: any) => r.externalId)).toEqual([
    '9',
    '1',
    '2',
    '3',
  ]);
  inbox.update(
    'facebook',
    {
      status: 'READY',
      conversations: [
        row('1', '8/4/2025'),
        row('2', '3 anos'),
        { ...row('3', 'Agora'), preview: 'Nova mensagem', unread: true },
      ],
    },
    now + 3000,
  );
  expect(inbox.state(profiles).conversations[0].externalId).toBe('3');
});
it('migra resumos antigos sem timestamp e não avança horários relativos a cada consulta', () => {
  const inbox = new UnifiedInbox();
  inbox.restore(
    [{ id: 'facebook', observedAt: now, rows: [row('1', '3 anos'), row('2', '5 min')] }],
    profiles,
  );
  const original = inbox
    .state(profiles)
    .conversations.find((r: any) => r.externalId === '2').messageAt;
  inbox.update(
    'facebook',
    { status: 'READY', conversations: [row('1', '3 anos'), row('2', '5 min')] },
    now + 60000,
  );
  expect(inbox.state(profiles).conversations.find((r: any) => r.externalId === '2').messageAt).toBe(
    original,
  );
  expect(inbox.state(profiles).conversations.map((r: any) => r.externalId)).toEqual(['2', '1']);
});
it('não trata uma data desconhecida como mensagem recém recebida', () => {
  const inbox = new UnifiedInbox();
  inbox.update('facebook', { status: 'READY', conversations: [row('1', '8/4/2025')] }, now);
  inbox.update(
    'facebook',
    { status: 'READY', conversations: [row('2', 'Data não disponível'), row('1', '8/4/2025')] },
    now + 1000,
  );
  expect(inbox.state(profiles).conversations.map((r: any) => r.externalId)).toEqual(['1', '2']);
});
