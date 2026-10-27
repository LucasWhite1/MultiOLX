const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const webpush = require('web-push');
const tagFor = (key) =>
  'multiolx-' + createHash('sha256').update(key).digest('base64url').slice(0, 20);
function subscriptionFor(input) {
  if (!input || typeof input.endpoint !== 'string' || input.endpoint.length > 2048)
    throw Error('Inscrição de notificações inválida.');
  const url = new URL(input.endpoint);
  const host = url.hostname;
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !(
      host === 'fcm.googleapis.com' ||
      host === 'android.googleapis.com' ||
      host === 'updates.push.services.mozilla.com' ||
      host === 'web.push.apple.com' ||
      /^[a-z0-9-]+\.notify\.windows\.com$/.test(host)
    )
  )
    throw Error('Serviço de notificações não reconhecido. Use Chrome, Edge, Firefox ou Safari.');
  const keys = input.keys;
  if (
    !keys ||
    !/^[A-Za-z0-9_-]{87}={0,1}$/.test(keys.p256dh || '') ||
    !/^[A-Za-z0-9_-]{22}={0,2}$/.test(keys.auth || '') ||
    Buffer.from(keys.p256dh, 'base64url').length !== 65 ||
    Buffer.from(keys.p256dh, 'base64url')[0] !== 4 ||
    Buffer.from(keys.auth, 'base64url').length !== 16
  )
    throw Error('Chaves de notificações inválidas.');
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}
class MessageChanges {
  constructor(initial = { conversations: [] }, now = Date.now()) {
    this.startedAt = now;
    this.rows = new Map(initial.conversations.map((c) => [c.key, c]));
  }
  observe(state) {
    const active = new Set(
      state.accounts.filter((a) => ['READY', 'DETAIL'].includes(a.status)).map((a) => a.id),
    );
    const changes = [];
    for (const row of state.conversations) {
      if (!active.has(row.profileId)) continue;
      const previous = this.rows.get(row.key);
      this.rows.set(row.key, row);
      if (row.unread !== true || row.lastDirection === 'outgoing') continue;
      if (
        previous
          ? previous.unread !== true ||
            previous.preview !== row.preview ||
            (Number.isInteger(row.unreadCount) && row.unreadCount > (previous.unreadCount || 0))
          : Number.isFinite(row.messageAt) && row.messageAt >= this.startedAt - 60000
      )
        changes.push(row);
    }
    const keys = new Set(state.conversations.map((c) => c.key));
    for (const key of this.rows.keys()) if (!keys.has(key)) this.rows.delete(key);
    return changes;
  }
}
async function createPushService({
  file,
  vault,
  origin,
  initial = { accounts: [], conversations: [] },
  send = (...args) => webpush.sendNotification(...args),
}) {
  let store;
  try {
    store = JSON.parse(vault.decryptString(await fs.readFile(file)));
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw Error('Não foi possível abrir as configurações de notificações.');
    store = { version: 1, vapid: webpush.generateVAPIDKeys(), subscriptions: [] };
  }
  if (
    store.version !== 1 ||
    !store.vapid?.publicKey ||
    !store.vapid?.privateKey ||
    !Array.isArray(store.subscriptions)
  )
    throw Error('Configuração de notificações inválida.');
  store.subscriptions = store.subscriptions.map(subscriptionFor);
  let saving = Promise.resolve();
  const persist = () => {
    const bytes = vault.encryptString(JSON.stringify(store));
    saving = saving
      .catch(() => {})
      .then(async () => {
        const temp = file + '.' + randomUUID() + '.tmp';
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(temp, bytes, { mode: 0o600 });
        await fs.rename(temp, file);
      });
    return saving;
  };
  await persist();
  const detector = new MessageChanges(initial);
  let lastState = initial,
    delivery = Promise.resolve(),
    closed = false;
  const unread = (state) => state.conversations.filter((c) => c.unread === true);
  async function deliver(subscription, payload) {
    try {
      await send(subscription, JSON.stringify(payload), {
        vapidDetails: { subject: origin, ...store.vapid },
        TTL: 3600,
        urgency: 'high',
        timeout: 8000,
        topic: createHash('sha256').update(payload.tag).digest('base64url').slice(0, 32),
      });
      return true;
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) {
        store.subscriptions = store.subscriptions.filter(
          (s) => s.endpoint !== subscription.endpoint,
        );
        await persist();
      }
      return false;
    }
  }
  const payloadFor = (row) => {
    const rows = unread(lastState);
    return {
      title: 'Nova mensagem · MultiOLX',
      body: `Você tem ${rows.length} conversa${rows.length === 1 ? '' : 's'} não lida${rows.length === 1 ? '' : 's'}. Toque para abrir.`,
      tag: tagFor(row.key),
      conversationKey: row.key,
      count: rows.length,
      // Only opaque tags leave the encrypted payload; no message previews on the lock screen.
      unreadTags: rows.length <= 100 ? rows.map((c) => tagFor(c.key)) : null,
    };
  };
  return {
    publicKey: store.vapid.publicKey,
    count: () => store.subscriptions.length,
    async subscribe(input) {
      const subscription = subscriptionFor(input);
      if (!store.subscriptions.some((s) => s.endpoint === subscription.endpoint)) {
        if (store.subscriptions.length >= 100) throw Error('Limite de dispositivos atingido.');
        store.subscriptions.push(subscription);
      } else
        store.subscriptions = store.subscriptions.map((s) =>
          s.endpoint === subscription.endpoint ? subscription : s,
        );
      await persist();
      return { ok: true };
    },
    async unsubscribe(endpoint) {
      store.subscriptions = store.subscriptions.filter((s) => s.endpoint !== endpoint);
      await persist();
      return { ok: true };
    },
    async test(endpoint) {
      const subscription = store.subscriptions.find((s) => s.endpoint === endpoint);
      if (!subscription) throw Error('Ative as notificações neste dispositivo primeiro.');
      const ok = await deliver(subscription, {
        title: 'MultiOLX conectado',
        body: 'As notificações estão ativadas neste dispositivo.',
        tag: 'multiolx-test',
        count: unread(lastState).length,
      });
      if (!ok)
        throw Error(
          'O serviço de notificações não aceitou o teste. Tente reativar as notificações.',
        );
      return { ok: true };
    },
    observe(state) {
      if (closed) return;
      lastState = state;
      const changes = detector.observe(state);
      if (!changes.length || !store.subscriptions.length) return;
      delivery = delivery
        .catch(() => {})
        .then(async () => {
          // Bounded work per snapshot; each conversation uses one replaceable notification.
          for (const row of changes.length > 20 ? [changes.at(-1)] : changes) {
            const current = lastState.conversations.find((c) => c.key === row.key);
            if (!current?.unread || current.lastDirection === 'outgoing') continue;
            const recipients = [...store.subscriptions];
            for (let i = 0; i < recipients.length; i += 5)
              await Promise.all(recipients.slice(i, i + 5).map((s) => deliver(s, payloadFor(row))));
          }
        });
    },
    async flush() {
      await delivery;
      await saving;
    },
    async close() {
      closed = true;
      await delivery;
      await saving;
    },
  };
}
module.exports = { createPushService, MessageChanges, subscriptionFor, tagFor };
