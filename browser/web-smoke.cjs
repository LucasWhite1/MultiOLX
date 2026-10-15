const fs = require('node:fs/promises');
const path = require('node:path');
async function runWebSmoke({
  app,
  BrowserWindow,
  root,
  port,
  openSession,
  views,
  nativeImage,
  restore = false,
}) {
  if (!path.basename(root).startsWith('multiolx-web-test-'))
    throw Error('O teste web exige um diretório temporário próprio.');
  const artifactDirectory = process.env.MULTIOLX_TEST_ARTIFACTS || path.resolve('artifacts');
  const origin = `http://127.0.0.1:${port}`;
  const panel = new BrowserWindow({
    width: 390,
    height: 844,
    minWidth: 300,
    show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const errors = [];
  panel.webContents.on('console-message', (_event, level, message) => {
    if (level === 3) errors.push(message);
  });
  const execute = (code) => panel.webContents.executeJavaScript(code);
  const wait = async (fn) => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error('Tempo de espera do teste web excedido.');
  };
  await panel.loadURL(origin + '/login');
  await execute(
    `document.getElementById('username').value='admin';document.getElementById('password').value=${JSON.stringify(process.env.MULTIOLX_TEST_PASSWORD)};document.getElementById('loginForm').requestSubmit();`,
  );
  await wait(() => Promise.resolve(panel.webContents.getURL() === origin + '/'));
  await wait(() => execute('!!window.multiBrowser && !!document.getElementById("webLogout")'));
  await execute('window.multiBrowser.list()');
  if (restore) {
    const data = await execute('window.multiBrowser.listListings()');
    if (
      !data.profiles.some((p) => p.name === 'Conta web') ||
      !data.drafts.some((d) => d.base.title === 'Produto web de teste' && d.photos.length === 1)
    )
      throw Error('Dados web não sobreviveram ao reinício.');
    console.log(
      'MULTIOLX_WEB_RESTART_OK: autenticação e cofre AES persistido restaurados em outro processo.',
    );
    panel.destroy();
    app.quit();
    return;
  }
  const profile = await execute("window.multiBrowser.create('Conta web')");
  const ses = await openSession(profile.id);
  ses.protocol.handle(
    'https',
    () =>
      new Response(
        '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>OLX de teste</title><input id="message" style="position:absolute;left:20px;top:30px;width:240px;height:45px"><button style="position:absolute;left:20px;top:100px" onclick="document.body.dataset.clicked=\'yes\'">Confirmar</button>',
        { headers: { 'Content-Type': 'text/html;charset=utf-8' } },
      ),
  );
  await execute(`window.multiBrowser.open(${JSON.stringify(profile.id)})`);
  await wait(() => execute('!document.getElementById("remoteBrowser").hidden'));
  let frame;
  await wait(async () => {
    frame = await execute(
      `fetch('/api/frame').then(async r=>({status:r.status,target:Number(r.headers.get('X-Remote-Target')),size:(await r.clone().arrayBuffer()).byteLength,error:r.status===200?'':await r.text()}))`,
    );
    return frame.status === 200;
  });
  if (frame.status !== 200 || frame.size < 500) throw Error('Imagem remota não foi transmitida.');
  const input = (command) =>
    execute(
      `(async()=>{const s=await(await fetch('/api/session')).json();const r=await fetch('/api/input',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify(${JSON.stringify({ target: frame.target, ...command })})});if(!r.ok)throw Error(await r.text());return r.json();})()`,
    );
  await input({ action: 'click', x: 50, y: 50 });
  await input({ action: 'text', text: 'Mensagem via navegador remoto' });
  if (
    (await views
      .get(profile.id)
      .webContents.executeJavaScript('document.getElementById("message").value')) !==
    'Mensagem via navegador remoto'
  )
    throw Error('Entrada remota não chegou ao navegador da conta.');
  await input({ action: 'click', x: 50, y: 115 });
  if (
    (await views.get(profile.id).webContents.executeJavaScript('document.body.dataset.clicked')) !==
    'yes'
  )
    throw Error('Clique remoto não chegou ao formulário.');
  const accountTarget = frame.target;
  await views
    .get(profile.id)
    .webContents.executeJavaScript(
      "window.open('https://accounts.google.com/fixture-login');void 0;",
    );
  await wait(async () => {
    frame = await execute(
      "fetch('/api/frame').then(async r=>({status:r.status,target:Number(r.headers.get('X-Remote-Target')),size:(await r.arrayBuffer()).byteLength}))",
    );
    return frame.status === 200 && frame.target !== accountTarget;
  });
  await input({ action: 'click', x: 50, y: 50 });
  await input({ action: 'text', text: 'Login de teste sem credenciais reais' });
  await input({ action: 'close-popup' });
  await wait(async () => {
    frame = await execute(
      "fetch('/api/frame').then(async r=>({status:r.status,target:Number(r.headers.get('X-Remote-Target')),size:(await r.arrayBuffer()).byteLength}))",
    );
    return frame.status === 200 && frame.target === accountTarget;
  });
  // Create and persist a draft and photo through the authenticated HTTP bridge.
  const bytes = nativeImage
    .createFromBitmap(Buffer.alloc(100 * 100 * 4, 255), { width: 100, height: 100 })
    .toPNG()
    .toString('base64');
  const photos = await execute(
    `(async()=>{const s=await(await fetch('/api/session')).json();const r=await fetch('/api/photos',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({files:[{name:'produto.png',data:${JSON.stringify(bytes)}}]})});const d=await r.json();if(!r.ok)throw Error(d.error);return d.result;})()`,
  );
  const draft = await execute('window.multiBrowser.createListing()');
  draft.base = {
    title: 'Produto web de teste',
    description: 'Descrição real da fixture',
    price: '100',
    postalCode: '41347290',
    category: 'Caixas de som',
    condition: 'Novo',
    group: 'Produtos',
    details: '',
  };
  draft.targets = [profile.id];
  draft.photos = photos.map((p) => p.id);
  await execute(`window.multiBrowser.saveListing(${JSON.stringify(draft)})`);
  await execute('window.multiListings.open()');
  await wait(() => execute('!document.getElementById("listingWorkspace").hidden'));
  for (const [width, height, name] of [
    [390, 844, 'mobile'],
    [1380, 900, 'desktop'],
  ]) {
    panel.setContentSize(width, height);
    panel.show();
    panel.focus();
    await new Promise((r) => setTimeout(r, 200));
    const layout = await execute(
      `({width:innerWidth,scroll:document.documentElement.scrollWidth,columns:getComputedStyle(document.querySelector('.listing-columns')).gridTemplateColumns,sidebar:getComputedStyle(document.querySelector('aside')).display,errors:document.getElementById('listingNotice').textContent})`,
    );
    if (layout.scroll > layout.width + 2 || (name === 'mobile' && layout.sidebar !== 'none'))
      throw Error('Layout web transbordou: ' + JSON.stringify(layout));
    await fs.mkdir(artifactDirectory, { recursive: true });
    await fs.writeFile(
      path.join(artifactDirectory, 'web-' + name + '.png'),
      (
        await panel.webContents.capturePage(undefined, { stayHidden: false, stayAwake: true })
      ).toPNG(),
    );
  }
  if (errors.some((e) => /Uncaught|Content Security Policy|Refused to/.test(e)))
    throw Error('Erro na interface web: ' + errors.join('\n'));
  const raw = await fs.readFile(path.join(root, 'announcements.enc'));
  if (raw.includes(Buffer.from('Produto web de teste')))
    throw Error('Rascunho web não está cifrado.');
  console.log(
    'MULTIOLX_WEB_OK: login real, RPC, foto, cofre, layout 390/1380px, imagem e teclado/clique remotos.',
  );
  await execute(
    `(async()=>{const s=await(await fetch('/api/session')).json();await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:'{}'});})()`,
  );
  if ((await execute("fetch('/api/session').then(r=>r.status)")) !== 401)
    throw Error('Logout não revogou a sessão.');
  panel.destroy();
  app.quit();
}
module.exports = { runWebSmoke };
