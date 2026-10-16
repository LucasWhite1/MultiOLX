const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { verifyPassword, validHash } = require('./server-vault.cjs');
const channels = new Set([
  'profiles:list',
  'facebook:connect',
  'profiles:create',
  'profiles:rename',
  'profiles:remove',
  'profiles:open',
  'profiles:close',
  'browser:navigate',
  'browser:economy',
  'browser:budget',
  'inbox:state',
  'inbox:show',
  'inbox:refresh',
  'inbox:open',
  'listings:show',
  'listings:list',
  'listings:ai-status',
  'listings:ai-configure',
  'listings:ai-test',
  'listings:create',
  'listings:save',
  'listings:review',
  'listings:prepare',
  'listings:fill',
  'listings:resolve',
  'listings:submit',
  'listings:publish-all',
  'listings:batch-state',
  'listings:batch-cancel',
]);
const reads = new Set([
  'profiles:list',
  'inbox:state',
  'listings:list',
  'listings:ai-status',
  'listings:review',
  'listings:batch-state',
]);
function configuration(env = process.env) {
  const origin = new URL(env.MULTIOLX_PUBLIC_URL || '');
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)
    throw Error('MULTIOLX_PUBLIC_URL deve ser a origem do domínio, sem caminho.');
  const dev =
    env.MULTIOLX_ALLOW_HTTP === '1' && ['localhost', '127.0.0.1'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !(dev && origin.protocol === 'http:'))
    throw Error(
      'Configure HTTPS em MULTIOLX_PUBLIC_URL. HTTP só é permitido em localhost para testes.',
    );
  if (!env.MULTIOLX_ADMIN_USER?.trim() || !validHash(env.MULTIOLX_ADMIN_PASSWORD_HASH))
    throw Error('Configure MULTIOLX_ADMIN_USER e MULTIOLX_ADMIN_PASSWORD_HASH.');
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('PORT inválida.');
  return {
    origin: origin.origin,
    secure: origin.protocol === 'https:',
    user: env.MULTIOLX_ADMIN_USER.trim(),
    hash: env.MULTIOLX_ADMIN_PASSWORD_HASH,
    port,
    host: env.MULTIOLX_BIND_HOST || '0.0.0.0',
  };
}
async function createWebServer(options) {
  const config = options.config || configuration(),
    sessions = new Map(),
    attempts = new Map(),
    streams = new Map();
  let controller = null,
    leaseUntil = 0,
    loginBusy = false;
  const same = (a, b) =>
    typeof a === 'string' &&
    typeof b === 'string' &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  const cookie = (value, age) =>
    `multiolx_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${config.secure ? '; Secure' : ''}`;
  const remove = (id) => {
    sessions.delete(id);
    for (const res of streams.get(id) || []) res.end();
    streams.delete(id);
    if (controller === id) {
      controller = null;
      leaseUntil = 0;
    }
  };
  const current = (req) => {
    const id = (req.headers.cookie || '')
      .split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('multiolx_session='))
      ?.slice(17);
    const entry = sessions.get(id);
    if (!entry) return null;
    if (entry.expires < Date.now() || entry.idle < Date.now()) {
      remove(id);
      return null;
    }
    entry.idle = Date.now() + 3600000;
    return { id, ...entry };
  };
  const control = (id) => {
    if (controller && controller !== id && leaseUntil > Date.now())
      throw Object.assign(
        Error(
          'Outro dispositivo está controlando o navegador. Libere o controle nele ou aguarde 60 segundos.',
        ),
        { status: 409 },
      );
    controller = id;
    leaseUntil = Date.now() + 60000;
  };
  async function body(req, max = 1024 * 1024) {
    let size = 0;
    const parts = [];
    for await (const part of req) {
      size += part.length;
      if (size > max)
        throw Object.assign(Error('Arquivo ou solicitação muito grande.'), { status: 413 });
      parts.push(part);
    }
    try {
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    } catch {
      throw Object.assign(Error('JSON inválido.'), { status: 400 });
    }
  }
  const assets = new Map([
    ['/style.css', ['style.css', 'text/css']],
    ['/ui.js', ['ui.js', 'text/javascript']],
    ['/listing-ui.js', ['listing-ui.js', 'text/javascript']],
    ['/web-bridge.js', ['web-bridge.js', 'text/javascript']],
    ['/web.css', ['web.css', 'text/css']],
    ['/login.js', ['login.js', 'text/javascript']],
  ]);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    if (config.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, 'http://internal');
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true });
      if (
        req.method === 'POST' &&
        (req.headers.origin !== config.origin ||
          !String(req.headers['content-type']).startsWith('application/json'))
      )
        return json(res, 403, { error: 'Origem não autorizada.' });
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const ip = req.socket.remoteAddress || 'unknown',
          now = Date.now();
        const limiter = attempts.get(ip) || { count: 0, until: now + 900000 };
        if (limiter.until < now) {
          limiter.count = 0;
          limiter.until = now + 900000;
        }
        attempts.set(ip, limiter);
        if (limiter.count >= 8 || loginBusy)
          return json(res, 429, { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' });
        const input = await body(req, 2048);
        limiter.count++;
        loginBusy = true;
        let valid = false;
        try {
          const passwordOK = verifyPassword(input.password, config.hash);
          valid = same(input.username, config.user) && passwordOK;
        } finally {
          loginBusy = false;
        }
        if (!valid) return json(res, 401, { error: 'Usuário ou senha incorretos.' });
        if (sessions.size >= 100) remove(sessions.keys().next().value);
        const id = randomBytes(32).toString('hex');
        sessions.set(id, {
          csrf: randomBytes(24).toString('hex'),
          expires: now + 12 * 3600000,
          idle: now + 3600000,
        });
        attempts.delete(ip);
        res.setHeader('Set-Cookie', cookie(id, 43200));
        return json(res, 200, { ok: true });
      }
      const auth = current(req);
      if (req.method === 'GET' && ['/login', '/login.js', '/web.css'].includes(url.pathname)) {
        const file = url.pathname === '/login' ? 'login.html' : url.pathname.slice(1);
        res.setHeader(
          'Content-Type',
          file.endsWith('.html')
            ? 'text/html; charset=utf-8'
            : file.endsWith('.css')
              ? 'text/css'
              : 'text/javascript',
        );
        return res.end(await fs.readFile(path.join(__dirname, file)));
      }
      if (!auth) {
        if (req.method === 'GET' && url.pathname === '/') {
          res.writeHead(302, { Location: '/login' });
          return res.end();
        }
        return json(res, 401, { error: 'Entre novamente para continuar.' });
      }
      if (req.method === 'POST' && !same(req.headers['x-csrf-token'], auth.csrf))
        return json(res, 403, { error: 'Sessão inválida. Atualize a página.' });
      if (req.method === 'GET' && url.pathname === '/api/session')
        return json(res, 200, {
          user: config.user,
          csrf: auth.csrf,
          state: options.snapshot(),
          batch: options.batch?.(),
          controller: controller === auth.id || !controller || leaseUntil < Date.now(),
        });
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        remove(auth.id);
        res.setHeader('Set-Cookie', cookie('', 0));
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/control/release') {
        if (controller === auth.id) {
          controller = null;
          leaseUntil = 0;
        }
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        if ((streams.get(auth.id)?.size || 0) >= 4)
          return json(res, 429, { error: 'Muitas conexões.' });
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'X-Accel-Buffering': 'no',
          Connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        if (!streams.has(auth.id)) streams.set(auth.id, new Set());
        streams.get(auth.id).add(res);
        req.on('close', () => streams.get(auth.id)?.delete(res));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/rpc') {
        const input = await body(req);
        if (!channels.has(input.channel) || !Array.isArray(input.args) || input.args.length > 4)
          return json(res, 400, { error: 'Operação inválida.' });
        if (!reads.has(input.channel)) control(auth.id);
        return json(res, 200, { result: await options.invoke(input.channel, input.args) });
      }
      if (req.method === 'POST' && url.pathname === '/api/photos') {
        control(auth.id);
        const input = await body(req, 30 * 1024 * 1024);
        if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > 20)
          throw Error('Selecione entre 1 e 20 fotos.');
        for (const file of input.files)
          if (
            typeof file.name !== 'string' ||
            file.name.length > 150 ||
            typeof file.data !== 'string' ||
            file.data.length > 28 * 1024 * 1024 ||
            !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)
          )
            throw Error('Foto inválida.');
        return json(res, 200, { result: await options.photos(input.files) });
      }
      if (req.method === 'GET' && url.pathname === '/api/frame') {
        if (auth.lastFrame && Date.now() - auth.lastFrame < 200)
          return json(res, 429, { error: 'Aguarde o próximo quadro.' });
        sessions.get(auth.id).lastFrame = Date.now();
        const frame = await options.frame();
        if (!frame) {
          res.writeHead(204);
          return res.end();
        }
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('X-Remote-Target', String(frame.id));
        res.setHeader('X-Remote-Width', String(frame.width));
        res.setHeader('X-Remote-Height', String(frame.height));
        return res.end(frame.bytes);
      }
      if (req.method === 'POST' && url.pathname === '/api/input') {
        control(auth.id);
        return json(res, 200, { result: await options.input(await body(req, 65536)) });
      }
      if (req.method === 'GET' && url.pathname === '/') {
        let html = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
        html = html
          .replace(/    <meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '')
          .replace(
            '</head>',
            '<link rel="stylesheet" href="web.css"><script src="web-bridge.js" defer></script></head>',
          );
        // All application scripts must run after the bridge, in document order.
        html = html
          .replace('<script src="ui.js">', '<script src="ui.js" defer>')
          .replace('<script src="listing-ui.js">', '<script src="listing-ui.js" defer>');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(html);
      }
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        res.setHeader('Content-Type', type + '; charset=utf-8');
        return res.end(await fs.readFile(path.join(__dirname, file)));
      }
      return json(res, 404, { error: 'Não encontrado.' });
    } catch (error) {
      if (!res.headersSent)
        json(res, error.status || 400, { error: error.message || 'A operação falhou.' });
      else res.end();
    }
  });
  server.requestTimeout = 150000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 60;
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of sessions) if (entry.expires < now || entry.idle < now) remove(id);
    for (const [ip, entry] of attempts) if (entry.until < now) attempts.delete(ip);
    for (const set of streams.values())
      for (const res of set)
        if (!res.destroyed && !res.writableNeedDrain) res.write(': keepalive\n\n');
  }, 20000);
  heartbeat.unref();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  return {
    server,
    emit(channel, state) {
      const data = `data: ${JSON.stringify({ channel, state })}\n\n`;
      for (const [id, set] of streams)
        if (sessions.has(id))
          for (const res of set) {
            if (res.writableLength > 256000) res.destroy();
            else if (!res.destroyed) res.write(data);
          }
    },
    async close() {
      clearInterval(heartbeat);
      for (const id of sessions.keys()) remove(id);
      await new Promise((resolve) => server.close(resolve));
    },
    port: server.address().port,
  };
}
module.exports = { createWebServer, configuration, channels };
