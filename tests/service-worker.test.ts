import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const code = readFileSync(new URL('../browser/sw.js', import.meta.url), 'utf8');
function fixture() {
  const handlers = new Map();
  const stale = { tag: 'multiolx-old', close: vi.fn() };
  const worker = {
    addEventListener: (type: string, fn: any) => handlers.set(type, fn),
    skipWaiting: vi.fn(),
    navigator: { setAppBadge: vi.fn(), clearAppBadge: vi.fn() },
    location: { origin: 'https://multiolx.example' },
    registration: {
      getNotifications: vi.fn(async () => [stale]),
      showNotification: vi.fn(async () => {}),
    },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => [] as any[]), openWindow: vi.fn() },
  };
  runInNewContext(code, {
    self: worker,
    URL,
    Response,
    fetch: async () => {
      throw Error('offline');
    },
  });
  return {
    worker,
    stale,
    dispatch: async (type: string, event: any) => {
      let promise: any;
      handlers.get(type)({
        ...event,
        waitUntil: (value: any) => {
          promise = value;
        },
        respondWith: (value: any) => {
          promise = value;
        },
      });
      return await promise;
    },
  };
}
it('exibe push com ícone, contador e conversa e remove avisos já lidos', async () => {
  const f = fixture();
  await f.dispatch('push', {
    data: {
      json: () => ({
        title: 'Nova mensagem',
        body: 'Abra para responder',
        count: 3,
        tag: 'multiolx-new',
        unreadTags: ['multiolx-new'],
        conversationKey: 'profile:123',
      }),
    },
  });
  expect(f.worker.navigator.setAppBadge).toHaveBeenCalledWith(3);
  expect(f.stale.close).toHaveBeenCalledOnce();
  expect(f.worker.registration.showNotification).toHaveBeenCalledWith(
    'Nova mensagem',
    expect.objectContaining({
      icon: '/icons/app-192.png',
      tag: 'multiolx-new',
      data: { conversationKey: 'profile:123' },
    }),
  );
});
it('limpa contador ao visualizar e abre conversa pelo aviso sem recarregar um rascunho existente', async () => {
  const f = fixture();
  await f.dispatch('message', { data: { type: 'badge', count: 0, unreadTags: [] } });
  expect(f.worker.navigator.clearAppBadge).toHaveBeenCalledOnce();
  const client = { url: 'https://multiolx.example/', focus: vi.fn(), postMessage: vi.fn() };
  f.worker.clients.matchAll.mockResolvedValue([client]);
  await f.dispatch('notificationclick', {
    notification: { close: vi.fn(), data: { conversationKey: 'profile:123' } },
  });
  expect(client.focus).toHaveBeenCalledOnce();
  expect(client.postMessage).toHaveBeenCalledWith({
    type: 'open-conversation',
    key: 'profile:123',
  });
  expect(f.worker.clients.openWindow).not.toHaveBeenCalled();
});
it('mostra uma página sem dados pessoais quando o aplicativo está offline', async () => {
  const f = fixture();
  const response = await f.dispatch('fetch', {
    request: { mode: 'navigate', url: 'https://multiolx.example/' },
  });
  expect(response.status).toBe(503);
  expect(await response.text()).toContain('Você está sem conexão');
});
