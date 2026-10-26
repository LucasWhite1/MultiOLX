import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const { adMetrics, cachedConversations } = createRequire(import.meta.url)(
  '../browser/ad-metrics.cjs',
);
const now = Date.parse('2026-10-26T15:00:00Z');
it('lê visitas e publicação em formato brasileiro, com dias de calendário', () => {
  expect(adMetrics('PUBLICADO Perfume R$ 250,00 3 visitas 15/10/26 às 17:39', now)).toMatchObject({
    daysPublished: 11,
    publishedDate: '2026-10-15',
    views: 3,
    messages: null,
  });
  expect(adMetrics('0 visualizações 26/10/2026', now)).toMatchObject({
    daysPublished: 0,
    views: 0,
  });
  expect(adMetrics('1 visita 25/10/26 às 23:59', now)).toMatchObject({
    daysPublished: 1,
    views: 1,
  });
});
it('não troca ausência por zero nem interpreta preços, datas inválidas e contadores abreviados', () => {
  expect(adMetrics('R$ 1.234,00 31/02/26', now)).toMatchObject({
    views: null,
    daysPublished: null,
    messages: null,
  });
  expect(adMetrics('1,2 mil visitas 27/10/26', now)).toMatchObject({
    views: null,
    daysPublished: null,
  });
  expect(adMetrics('15/10/26 20/10/26', now).daysPublished).toBeNull();
});
it('preserva a diferença entre mensagens recebidas e conversas e interpreta milhares', () => {
  expect(adMetrics('1.234 visitas Mensagens recebidas: 22 4 conversas', now)).toMatchObject({
    views: 1234,
    messages: 22,
    messagesScope: 'received',
    conversations: 4,
  });
  expect(adMetrics('9 mensagens', now)).toMatchObject({
    messages: 9,
    messagesScope: 'unspecified',
  });
});
it('respeita o dia local do Brasil na virada de UTC e valida datetime', () => {
  expect(adMetrics('25/10/26', Date.parse('2026-10-26T01:00:00Z')).daysPublished).toBe(0);
  expect(adMetrics('', now, '2026-10-14T20:00:00-03:00').daysPublished).toBe(12);
  expect(adMetrics('', now, '2026-10-15T01:00:00Z').daysPublished).toBe(12);
});
it('relaciona conversas só à mesma conta e a título único, sem assumir total de mensagens', () => {
  const item = { owner: 'a', title: 'Perfume' },
    chat = {
      accounts: [{ id: 'a', observedAt: '2026-10-26T10:00:00Z' }],
      conversations: [
        { profileId: 'a', listingTitle: 'PERFUME', key: 'a:1' },
        { profileId: 'b', listingTitle: 'Perfume', key: 'b:2' },
      ],
    };
  expect(cachedConversations(item, [item], chat).count).toBe(1);
  expect(cachedConversations(item, [item, item], chat)).toBeNull();
  expect(cachedConversations(item, [item], { accounts: [], conversations: [] })).toBeNull();
});
