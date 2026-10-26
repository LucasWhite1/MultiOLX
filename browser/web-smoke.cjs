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
    // The server's native window shares this test desktop and would occlude the client.
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
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
    const evidence = await execute(
      `({status:document.getElementById('status')?.textContent,rows:document.querySelectorAll('.conversation-row').length,replyHidden:document.querySelector('.remote-reply')?.hidden,remoteHidden:document.getElementById('remoteBrowser')?.hidden})`,
    );
    throw Error(
      'Tempo de espera do teste web excedido: ' +
        fn.toString().slice(0, 160) +
        ' ' +
        JSON.stringify(evidence),
    );
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
  const chatFixture = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:16px sans-serif;margin:12px}a{display:block;padding:12px;background:#f5f3ff}textarea{position:fixed;bottom:12px;left:12px;width:85%;height:50px}.bubble{padding:12px;background:#ede9fe;margin:12px 0}</style><title>Chat OLX local</title><a data-testid="chat-list-item" id="mobile" href="?chat-id=mobile"><span class="typo-caption">Produto de teste</span><div class="text-2">Cliente de teste</div><div class="text-1-5">Está disponível?</div><div class="text-1-5">Agora</div></a><div id="messages"></div><script>document.querySelector('a').onclick=e=>{e.preventDefault();history.pushState(null,'','?chat-id=mobile');document.querySelector('#messages').innerHTML='<p>Está disponível?</p><textarea aria-label="Mensagem"></textarea>';document.querySelector('textarea').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();const p=document.createElement('p');p.className='bubble';p.textContent=e.target.value;document.querySelector('#messages').prepend(p);window.sent=(window.sent||[]).concat(e.target.value);e.target.value='';}};};</script>`;
  const ses = await openSession(profile.id);
  ses.protocol.handle(
    'https',
    (request) =>
      new Response(
        new URL(request.url).hostname === 'chat.olx.com.br'
          ? chatFixture
          : '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>OLX de teste</title><input id="message" style="position:absolute;left:20px;top:30px;width:240px;height:45px"><button style="position:absolute;left:20px;top:100px" onclick="document.body.dataset.clicked=\'yes\'">Confirmar</button>',
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
  await execute('window.multiBrowser.unified()');
  await wait(() => execute("document.querySelectorAll('.conversation-row').length>0"));
  await execute("document.querySelector('.conversation-row').click()");
  panel.show();
  panel.focus();
  await wait(() =>
    execute(
      "!document.querySelector('.remote-reply').hidden && document.getElementById('remoteImage').naturalWidth>0",
    ),
  );
  await views.get(profile.id).webContents.executeJavaScript(`(()=>{
    document.getElementById('messages').setAttribute('aria-hidden','true');
    const dialog=document.createElement('div');dialog.id='mobile-promotion';dialog.setAttribute('role','dialog');dialog.style.cssText='position:fixed;inset:0;background:white;z-index:100';
    const heading=document.createElement('h2');heading.textContent='Evoluímos para você negociar com mais segurança';heading.style.width='100%';
    let step=0;const headings=['Evoluímos para você negociar com mais segurança','Informações para negociar com mais confiança','A experiência completa para fechar seu negócio por aqui'];
    const close=document.createElement('button');close.textContent='Próximo';close.onclick=()=>{step++;if(step<3){heading.textContent=headings[step];close.textContent=step===2?'Concluir':'Próximo';}else{document.getElementById('messages').removeAttribute('aria-hidden');dialog.remove();}};
    dialog.append(heading,close);document.body.append(dialog);
  })()`);
  panel.focus();
  await execute("document.getElementById('remoteMessage').focus()");
  await wait(() =>
    execute(
      "document.querySelector('.remote-reply-notice').textContent.includes('pronto para responder')",
    ),
  );
  if (
    await views
      .get(profile.id)
      .webContents.executeJavaScript("!!document.getElementById('mobile-promotion')")
  )
    throw Error('Aviso da OLX continuou bloqueando o campo no mobile.');
  for (const [width, height, label] of [
    [412, 915, 'a33'],
    [360, 800, 'compact'],
    [412, 460, 'keyboard'],
    [915, 412, 'landscape'],
  ]) {
    if (label === 'compact') {
      await execute(`(async()=>{
        const session=await(await fetch('/api/session')).json();
        await fetch('/api/control/release',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:'{}'});
        const login=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:${JSON.stringify(process.env.MULTIOLX_TEST_PASSWORD)}})});
        if(!login.ok)throw Error('Não foi possível simular troca de sessão.');
      })()`);
      if (!(await execute('window.multiBrowser.list()')).some((p) => p.id === profile.id))
        throw Error('A aba não recuperou a autorização após troca de sessão.');
    }
    panel.setContentSize(width, height);
    await new Promise((r) => setTimeout(r, 250));
    await wait(async () => {
      panel.focus();
      return execute(
        "document.getElementById('remoteImage').naturalWidth===Math.max(360,Math.round(document.querySelector('.remote-stage').clientWidth))",
      );
    });
    const layout = await execute(
      `(()=>{const r=document.getElementById('remoteMessage').getBoundingClientRect(),b=document.getElementById('remoteSend').getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,bottom:b.bottom,fieldBottom:r.bottom,height:innerHeight,stage:document.querySelector('.remote-stage').clientHeight};})()`,
    );
    if (
      layout.scroll > width + 2 ||
      layout.bottom > height ||
      layout.fieldBottom > height ||
      layout.stage < 30
    )
      throw Error('Resposta móvel fora da tela: ' + JSON.stringify(layout));
    await execute(
      `document.getElementById('remoteMessage').value=${JSON.stringify('Resposta ' + label + ' — disponível!')};document.querySelector('.remote-reply').requestSubmit();`,
    );
    await wait(() => execute("!document.getElementById('remoteSend').disabled"));
    if ((await execute("document.getElementById('remoteMessage').value")) !== '')
      throw Error(
        'Resposta não enviada: ' +
          (await execute("document.querySelector('.remote-reply-notice').textContent")),
      );
    await fs.mkdir(artifactDirectory, { recursive: true });
    await fs.writeFile(
      path.join(artifactDirectory, 'web-chat-' + label + '.png'),
      (await panel.webContents.capturePage()).toPNG(),
    );
  }
  const sent = await views.get(profile.id).webContents.executeJavaScript('window.sent');
  if (sent.length !== 4 || !sent.every((s) => s.includes('disponível!')))
    throw Error('O envio móvel não chegou ao cliente de teste.');
  await views
    .get(profile.id)
    .webContents.executeJavaScript("document.querySelector('textarea').readOnly=true");
  await execute(
    "document.getElementById('remoteMessage').value='Rascunho preservado';document.querySelector('.remote-reply').requestSubmit()",
  );
  await wait(() => execute("!document.getElementById('remoteSend').disabled"));
  if ((await execute("document.getElementById('remoteMessage').value")) !== 'Rascunho preservado')
    throw Error('O rascunho foi perdido após erro de envio.');
  if ((await views.get(profile.id).webContents.executeJavaScript('window.sent')).length !== 4)
    throw Error('Campo indisponível recebeu um envio indevido.');
  await views
    .get(profile.id)
    .webContents.executeJavaScript("document.querySelector('textarea').readOnly=false");
  console.log(
    'MULTIOLX_MOBILE_CHAT_OK: resposta pela interface, A33 412px, 360px, teclado reduzido e paisagem, sem envios reais.',
  );
  await execute('window.multiBrowser.unified()');
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
