import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const { facebookThreadDocument } = createRequire(import.meta.url)('../browser/facebook-thread.cjs');
afterEach(() => vi.useRealTimers());
function read(label: string, id = '123') {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 27, 15, 30));
  const visible = { getClientRects: () => [{}], closest: () => null };
  const message = {
    ...visible,
    getAttribute: (key: string) => (key === 'aria-label' ? label : 'message-fixture'),
  };
  const main = {
    ...visible,
    contains: () => false,
    querySelectorAll: (selector: string) =>
      selector.includes('contenteditable') ? [visible] : [message],
  };
  return runInNewContext(`(${facebookThreadDocument.toString()})(${JSON.stringify(id)})`, {
    Date,
    location: { origin: 'https://www.facebook.com', pathname: '/messages/t/123/' },
    document: { querySelectorAll: () => [main] },
    getComputedStyle: () => ({ visibility: 'visible' }),
  });
}
it('lê o formato real de uma mensagem enviada hoje, sem exigir data completa', () => {
  expect(read('Às 15:19, Você: Mensagem de teste.')).toMatchObject({
    externalId: '123',
    preview: 'Mensagem de teste.',
    lastDirection: 'outgoing',
    timeLabel: '15:19',
    messageAt: new Date(2026, 9, 27, 15, 19).getTime(),
  });
});
it('lê data completa, ontem e dia da semana preservando a data real', () => {
  expect(read('Às 12 de setembro de 2026 13:00, Samuel: Disponível')).toMatchObject({
    preview: 'Disponível',
    lastDirection: 'incoming',
    messageAt: new Date(2026, 8, 12, 13).getTime(),
  });
  expect(read('Às Ontem 18:50, Cliente: Olá').messageAt).toBe(
    new Date(2026, 9, 26, 18, 50).getTime(),
  );
  expect(read('Às Segunda 18:50, Cliente: Olá').messageAt).toBe(
    new Date(2026, 9, 26, 18, 50).getTime(),
  );
});
it('recusa outra conversa e datas impossíveis e não transforma avisos sem autoria em mensagens', () => {
  expect(read('Às 15:19, Você: Mensagem', '999')).toBeNull();
  expect(read('Às 31 de fevereiro de 2026 12:00, Você: Mensagem')).toBeNull();
  expect(read('Às Segunda 18:50, ')).toBeNull();
  expect(read('Às 25:19, Você: Mensagem')).toBeNull();
});
