// No account pages, chat history, frames or credentials are cached offline.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
const badge = async (count) => {
  try {
    if (count > 0) await self.navigator.setAppBadge?.(count);
    else await self.navigator.clearAppBadge?.();
  } catch {}
};
async function syncNotices(data) {
  if (Array.isArray(data.unreadTags))
    for (const notice of await self.registration.getNotifications())
      if (notice.tag.startsWith('multiolx-') && !data.unreadTags.includes(notice.tag))
        notice.close();
  await badge(data.count);
}
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let data;
      try {
        data = event.data.json();
      } catch {
        data = {};
      }
      const count = Number.isSafeInteger(data.count) && data.count >= 0 ? data.count : 0;
      await syncNotices({ ...data, count });
      await self.registration.showNotification(data.title || 'Nova mensagem · MultiOLX', {
        body: data.body || 'Você recebeu uma nova mensagem. Abra o MultiOLX para responder.',
        icon: '/icons/app-192.png',
        badge: '/icons/badge-96.png',
        tag: data.tag || 'multiolx-message',
        renotify: true,
        data: {
          conversationKey: typeof data.conversationKey === 'string' ? data.conversationKey : null,
        },
      });
    })(),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'badge') event.waitUntil(syncNotices(event.data));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const key = event.notification.data?.conversationKey;
      const target = '/?app=1' + (key ? '&conversation=' + encodeURIComponent(key) : '');
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = clients.find(
        (c) => new URL(c.url).origin === self.location.origin && new URL(c.url).pathname === '/',
      );
      if (client) {
        await client.focus();
        client.postMessage({ type: 'open-conversation', key });
      } else await self.clients.openWindow(target);
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  if (
    event.request.mode === 'navigate' &&
    new URL(event.request.url).origin === self.location.origin
  )
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MultiOLX · Sem conexão</title><h1>Você está sem conexão</h1><p>Suas contas continuam no servidor. Reconecte à internet para ver e responder mensagens.</p><a href="/?app=1">Tentar novamente</a></html>',
            { status: 503, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
          ),
      ),
    );
});
