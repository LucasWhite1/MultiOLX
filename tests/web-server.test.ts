import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWebServer, configuration } = require('../browser/web-server.cjs');
const { passwordHash, verifyPassword, createServerVault } = require('../browser/server-vault.cjs');
const active: any[] = [];
afterEach(async () => {
  for (const app of active.splice(0)) await app.close();
});
const password = 'Senha de teste! 123456';
async function server() {
  const calls: any[] = [];
  const app = await createWebServer({
    config: {
      origin: 'http://localhost',
      secure: false,
      user: 'admin',
      hash: passwordHash(password),
      port: 0,
      host: '127.0.0.1',
    },
    snapshot: () => ({ mode: 'listings' }),
    invoke: async (...args: any[]) => {
      calls.push(args);
      return { ok: true };
    },
    frame: async () => ({ id: 12, width: 390, height: 700, bytes: Buffer.from('jpeg') }),
    input: async () => ({ ok: true }),
    photos: async () => [],
  });
  active.push(app);
  const url = `http://127.0.0.1:${app.port}`;
  return { app, url, calls };
}
async function login(url: string) {
  const response = await fetch(url + '/api/login', {
    method: 'POST',
    headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password }),
  });
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const session = await (await fetch(url + '/api/session', { headers: { Cookie: cookie } })).json();
  return { cookie, csrf: session.csrf };
}
const headers = (s: any) => ({
  Cookie: s.cookie,
  Origin: 'http://localhost',
  'Content-Type': 'application/json',
  'X-CSRF-Token': s.csrf,
});
it('protege painel, código, imagens e operações antes do login', async () => {
  const { url } = await server();
  for (const route of ['/api/session', '/api/frame', '/api/events', '/ui.js', '/listing-ui.js'])
    expect((await fetch(url + route)).status).toBe(401);
  expect((await fetch(url + '/', { redirect: 'manual' })).headers.get('location')).toBe('/login');
  expect((await fetch(url + '/healthz')).status).toBe(200);
});
it('valida origem, CSRF e lista de operações sem permitir IPC arbitrário', async () => {
  const { url, calls } = await server();
  const s = await login(url);
  const post = (body: any, h: any = headers(s)) =>
    fetch(url + '/api/rpc', { method: 'POST', headers: h, body: JSON.stringify(body) });
  expect(
    (
      await post(
        { channel: 'profiles:create', args: ['Teste'] },
        { ...headers(s), Origin: 'https://outro.site' },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await post(
        { channel: 'profiles:create', args: ['Teste'] },
        { ...headers(s), 'X-CSRF-Token': 'errado' },
      )
    ).status,
  ).toBe(403);
  expect((await post({ channel: 'arbitrary:exec', args: [] })).status).toBe(400);
  expect((await post({ channel: 'profiles:create', args: ['Teste'] })).status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(
    (
      await post(
        { channel: 'profiles:remove', args: [crypto.randomUUID()] },
        { ...headers(s), 'X-CSRF-Token': 'errado' },
      )
    ).status,
  ).toBe(403);
  expect((await post({ channel: 'profiles:remove', args: [crypto.randomUUID()] })).status).toBe(
    200,
  );
  expect(calls).toHaveLength(2);
});
it('usa cookie HttpOnly e revoga acesso ao sair', async () => {
  const { url } = await server();
  const s = await login(url);
  expect(s.cookie).toMatch(/^multiolx_session=/);
  expect((await fetch(url + '/api/session', { headers: { Cookie: s.cookie } })).status).toBe(200);
  await fetch(url + '/api/logout', { method: 'POST', headers: headers(s), body: '{}' });
  expect((await fetch(url + '/api/session', { headers: { Cookie: s.cookie } })).status).toBe(401);
});
it('expira a autenticação sem encerrar as contas OLX', async () => {
  const { url } = await server();
  const s = await login(url);
  const now = Date.now();
  const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 13 * 3600000);
  try {
    expect((await fetch(url + '/api/session', { headers: { Cookie: s.cookie } })).status).toBe(401);
  } finally {
    spy.mockRestore();
  }
});
it('impede dois dispositivos de controlar a mesma sessão e permite liberar', async () => {
  const { url } = await server();
  const a = await login(url),
    b = await login(url);
  const rpc = (s: any) =>
    fetch(url + '/api/rpc', {
      method: 'POST',
      headers: headers(s),
      body: JSON.stringify({ channel: 'profiles:open', args: ['id'] }),
    });
  expect((await rpc(a)).status).toBe(200);
  expect((await rpc(b)).status).toBe(409);
  expect(
    (
      await fetch(url + '/api/rpc', {
        method: 'POST',
        headers: headers(b),
        body: JSON.stringify({ channel: 'profiles:list', args: [] }),
      })
    ).status,
  ).toBe(200);
  await fetch(url + '/api/control/release', { method: 'POST', headers: headers(a), body: '{}' });
  expect((await rpc(b)).status).toBe(200);
});
it('limita tentativas incorretas de autenticação', async () => {
  const { url } = await server();
  let result;
  for (let i = 0; i < 9; i++)
    result = await fetch(url + '/api/login', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'errada' }),
    });
  expect(result!.status).toBe(429);
});
it('serve painel web com CSP e ponte HTTP antes dos scripts de interface', async () => {
  const { url } = await server();
  const s = await login(url);
  const response = await fetch(url + '/', { headers: { Cookie: s.cookie } });
  const html = await response.text();
  expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(html).not.toContain("connect-src 'none'");
  expect(html.indexOf('web-bridge.js')).toBeLessThan(html.indexOf('src="ui.js"'));
  expect(html).toContain('src="ui.js" defer');
});
it('cifra com autenticação e rejeita chave errada, alteração e arquivos do desktop', () => {
  const a = createServerVault('a'.repeat(64)),
    b = createServerVault('b'.repeat(64));
  const data = a.encryptString('sessão privada');
  expect(data.includes(Buffer.from('sessão privada'))).toBe(false);
  expect(a.decryptString(data)).toBe('sessão privada');
  expect(() => b.decryptString(data)).toThrow();
  data[data.length - 1] ^= 1;
  expect(() => a.decryptString(data)).toThrow();
  expect(() => a.decryptString(Buffer.from('Windows DPAPI'))).toThrow('incompatível');
});
it('não inicia com credenciais fracas, chave ausente ou origem insegura', () => {
  expect(() => passwordHash('123')).toThrow();
  expect(() => createServerVault('')).toThrow();
  expect(verifyPassword(password, passwordHash(password))).toBe(true);
  expect(() => configuration({ MULTIOLX_PUBLIC_URL: 'http://site.com' })).toThrow('HTTPS');
  expect(() =>
    configuration({
      MULTIOLX_PUBLIC_URL: 'https://site.com',
      MULTIOLX_ADMIN_USER: 'admin',
      MULTIOLX_ADMIN_PASSWORD_HASH: 'senha',
    }),
  ).toThrow('PASSWORD_HASH');
});
