import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createECDH } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {
  createPushService,
  MessageChanges,
  subscriptionFor,
} = require('../browser/push-service.cjs');
const { createServerVault } = require('../browser/server-vault.cjs');
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith('multiolx-push-test-'))
      throw Error('Destino de teste inválido');
    await rm(root, { recursive: true, force: true });
  }
});
const stamp = Date.now();
const conversation = (change: any = {}) => ({
  key: 'profile:123',
  profileId: 'profile',
  preview: 'Olá',
  unread: false,
  lastDirection: 'incoming',
  messageAt: stamp,
  ...change,
});
const state = (rows: any[], status = 'READY') => ({
  accounts: [{ id: 'profile', status }],
  conversations: rows,
});
const subscription = () => {
  const ec = createECDH('prime256v1');
  ec.generateKeys();
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/fixture-test',
    keys: {
      p256dh: ec.getPublicKey().toString('base64url'),
      auth: Buffer.alloc(16, 7).toString('base64url'),
    },
  };
};
it('notifica mudanças recebidas sem repetir leituras, horários relativos, mensagens próprias ou importações antigas', () => {
  const changes = new MessageChanges(state([conversation()]), stamp);
  expect(changes.observe(state([conversation({ unread: true })]))).toHaveLength(1);
  expect(changes.observe(state([conversation({ unread: true, timeLabel: '5 min' })]))).toHaveLength(
    0,
  );
  expect(
    changes.observe(state([conversation({ unread: true, preview: 'Outra mensagem' })])),
  ).toHaveLength(1);
  expect(
    changes.observe(
      state([conversation({ unread: true, preview: 'Minha mensagem', lastDirection: 'outgoing' })]),
    ),
  ).toHaveLength(0);
  expect(
    changes.observe(
      state([conversation({ key: 'profile:old', unread: true, messageAt: stamp - 86400000 })]),
    ),
  ).toHaveLength(0);
  expect(
    changes.observe(state([conversation({ key: 'profile:new', unread: true, messageAt: stamp })])),
  ).toHaveLength(1);
  expect(changes.observe(state([conversation({ unread: true })], 'AUTH_REQUIRED'))).toHaveLength(0);
});
it('valida destinos de push e rejeita URLs locais, hosts parecidos e chaves inválidas', () => {
  const value = subscription();
  expect(subscriptionFor(value)).toEqual(value);
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/x',
    'https://127.0.0.1/',
    'https://fcm.googleapis.com.evil.test/x',
    'https://fcm.googleapis.com:444/x',
    'https://user:secret@fcm.googleapis.com/x',
  ])
    expect(() => subscriptionFor({ ...value, endpoint })).toThrow();
  expect(() => subscriptionFor({ ...value, keys: { auth: 'x', p256dh: 'x' } })).toThrow();
});
async function fixture(send: any = vi.fn(async (..._args: any[]) => {})) {
  const root = await mkdtemp(path.join(tmpdir(), 'multiolx-push-test-'));
  roots.push(root);
  const options = {
    file: path.join(root, 'notifications.enc'),
    vault: createServerVault('ab'.repeat(32)),
    origin: 'https://multiolx.example',
    initial: state([conversation()]),
    send,
  };
  return { options, send, service: await createPushService(options) };
}
it('persiste chaves e inscrições criptografadas, envia uma vez e não vaza prévias no aviso', async () => {
  const f = await fixture();
  const sub = subscription();
  await f.service.subscribe(sub);
  await f.service.subscribe(sub);
  expect(f.service.count()).toBe(1);
  const update = state([conversation({ unread: true, preview: 'Conteúdo privado do cliente' })]);
  f.service.observe(update);
  f.service.observe(update);
  await f.service.flush();
  expect(f.send).toHaveBeenCalledTimes(1);
  const payload = JSON.parse(f.send.mock.calls[0][1]);
  expect(payload).toMatchObject({ count: 1, conversationKey: 'profile:123' });
  expect(JSON.stringify(payload)).not.toContain('Conteúdo privado');
  expect((await readFile(f.options.file)).includes(Buffer.from(sub.endpoint))).toBe(false);
  const restored = await createPushService(f.options);
  expect(restored.publicKey).toBe(f.service.publicKey);
  expect(restored.count()).toBe(1);
  await restored.unsubscribe(sub.endpoint);
  expect(restored.count()).toBe(0);
});
it('remove inscrições expiradas para não repetir envios inválidos após reiniciar', async () => {
  const f = await fixture(
    vi.fn(async () => {
      throw Object.assign(Error('gone'), { statusCode: 410 });
    }),
  );
  await f.service.subscribe(subscription());
  f.service.observe(state([conversation({ unread: true })]));
  await f.service.flush();
  expect(f.service.count()).toBe(0);
  expect((await createPushService(f.options)).count()).toBe(0);
});
