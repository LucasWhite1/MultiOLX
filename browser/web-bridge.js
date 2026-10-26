(() => {
  window.multiWeb = true;
  document.body.classList.add('web-app');
  document.querySelector('aside .hint').textContent =
    'As contas permanecem no servidor após fechar esta página. Sair da OLX pode revogar a sessão.';
  new ResizeObserver(() =>
    document.body.style.setProperty(
      '--header-height',
      document.querySelector('header').offsetHeight + 'px',
    ),
  ).observe(document.querySelector('header'));
  const updateScreen = () => {
    const screen = window.visualViewport;
    document.body.style.setProperty('--app-height', (screen?.height || innerHeight) + 'px');
    document.body.style.setProperty('--app-top', (screen?.offsetTop || 0) + 'px');
  };
  window.visualViewport?.addEventListener('resize', updateScreen);
  window.visualViewport?.addEventListener('scroll', updateScreen);
  window.addEventListener('resize', updateScreen);
  updateScreen();
  const listeners = new Map();
  let csrf = '',
    remoteTarget = 0,
    objectUrl,
    stream,
    remoteGeneration = 0,
    remoteProfile = null,
    busy = false,
    inputQueue = Promise.resolve();
  const notify = (channel, state) => {
    for (const fn of listeners.get(channel) || []) fn(state);
  };
  const ready = fetch('/api/session').then(async (response) => {
    if (response.status === 401) {
      location.replace('/login');
      throw Error('Entre para continuar.');
    }
    const session = await response.json();
    csrf = session.csrf;
    return session;
  });
  async function request(url, body, refreshed = false) {
    await ready;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status === 401) location.replace('/login');
    // A different tab can replace the shared login cookie. The server rejects
    // stale CSRF before executing anything, so only this specific rejection is retried.
    if (
      response.status === 403 &&
      data.error === 'Sessão inválida. Atualize a página.' &&
      !refreshed
    ) {
      const current = await fetch('/api/session', { cache: 'no-store' });
      if (current.ok) {
        csrf = (await current.json()).csrf;
        return request(url, body, true);
      }
    }
    if (!response.ok) throw Error(data.error);
    return Object.prototype.hasOwnProperty.call(data, 'result') ? data.result : data;
  }
  const map = {
    list: 'profiles:list',
    connectFacebook: 'facebook:connect',
    create: 'profiles:create',
    rename: 'profiles:rename',
    remove: 'profiles:remove',
    open: 'profiles:open',
    close: 'profiles:close',
    navigate: 'browser:navigate',
    economy: 'browser:economy',
    inbox: 'inbox:state',
    unified: 'inbox:show',
    refreshInbox: 'inbox:refresh',
    openConversation: 'inbox:open',
    budget: 'browser:budget',
    listings: 'listings:show',
    listListings: 'listings:list',
    scanManagedAds: 'listings:managed-scan',
    managedAds: 'listings:managed-state',
    openManagedAd: 'listings:managed-open',
    reviewAdRemoval: 'listings:managed-review',
    removeAds: 'listings:managed-delete',
    cancelAdManagement: 'listings:managed-cancel',
    listingAI: 'listings:ai-status',
    configureListingAI: 'listings:ai-configure',
    testListingAI: 'listings:ai-test',
    createListing: 'listings:create',
    saveListing: 'listings:save',
    reviewListing: 'listings:review',
    prepareListing: 'listings:prepare',
    fillListing: 'listings:fill',
    resolveListing: 'listings:resolve',
    submitListing: 'listings:submit',
    publishListings: 'listings:publish-all',
    listingBatch: 'listings:batch-state',
    cancelListingBatch: 'listings:batch-cancel',
  };
  const api = {};
  for (const [name, channel] of Object.entries(map))
    api[name] = (...args) => request('/api/rpc', { channel, args });
  for (const [name, channel] of Object.entries({
    onState: 'browser:state',
    onInbox: 'inbox:state',
    onResources: 'browser:resources',
    onListingBatch: 'listings:batch',
  }))
    api[name] = (fn) => {
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel).push(fn);
    };
  api.pickListingPhotos = () =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'image/jpeg,image/png,image/webp';
      input.oncancel = () => resolve([]);
      input.onchange = async () => {
        try {
          const imported = [];
          for (const file of input.files) {
            if (file.size > 18 * 1024 * 1024) throw Error('Escolha fotos de até 18 MB.');
            const data = await new Promise((ok, fail) => {
              const reader = new FileReader();
              reader.onload = () => ok(reader.result.split(',')[1]);
              reader.onerror = fail;
              reader.readAsDataURL(file);
            });
            imported.push(
              ...(await request('/api/photos', { files: [{ name: file.name, data }] })),
            );
          }
          resolve(imported);
        } catch (error) {
          document.getElementById('status').textContent = error.message;
          resolve([]);
        }
      };
      input.click();
    });
  window.multiBrowser = api;
  const node = (tag, text) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    return n;
  };
  const menu = node('button', '☰ Contas');
  menu.className = 'mobile-menu';
  menu.type = 'button';
  menu.setAttribute('aria-expanded', 'false');
  document.querySelector('header').prepend(menu);
  menu.onclick = () => {
    const open = document.body.classList.toggle('menu-open');
    menu.setAttribute('aria-expanded', String(open));
  };
  menu.setAttribute('aria-controls', 'accountSidebar');
  document.querySelector('aside').id = 'accountSidebar';
  const backdrop = node('button');
  backdrop.className = 'menu-backdrop';
  backdrop.setAttribute('aria-label', 'Fechar menu de contas');
  backdrop.onclick = () => {
    document.body.classList.remove('menu-open');
    menu.setAttribute('aria-expanded', 'false');
  };
  document.body.append(backdrop);
  const logout = node('button', 'Sair');
  logout.id = 'webLogout';
  document.querySelector('header').append(logout);
  const resourceControls = document.querySelector('.resource-controls');
  const mobileSettings = node('details');
  mobileSettings.className = 'mobile-settings';
  mobileSettings.append(node('summary', 'Desempenho'));
  document.querySelector('aside').append(mobileSettings);
  const mobileScreen = matchMedia('(max-width:760px), (max-width:1000px) and (max-height:500px)');
  const placeResources = () => {
    mobileSettings.hidden = !mobileScreen.matches;
    if (mobileScreen.matches) mobileSettings.append(resourceControls);
    else document.querySelector('header').insertBefore(resourceControls, logout);
  };
  mobileScreen.addEventListener('change', placeResources);
  placeResources();
  logout.onclick = async () => {
    await request('/api/logout', {});
    stream?.close();
    location.replace('/login');
  };
  const panel = node('section');
  panel.id = 'remoteBrowser';
  panel.hidden = true;
  const toolbar = node('div');
  toolbar.className = 'remote-tools';
  const back = node('button', '← Painel'),
    release = node('button', 'Liberar controle'),
    closePopup = node('button', 'Fechar janela de login');
  toolbar.append(back, release, closePopup);
  const image = node('img');
  image.id = 'remoteImage';
  image.alt = 'Navegador OLX no servidor';
  image.draggable = false;
  image.tabIndex = 0;
  const stage = node('div');
  stage.className = 'remote-stage';
  stage.append(image);
  const caption = node('p');
  caption.className = 'remote-caption';
  const typing = node('form');
  typing.className = 'remote-typing';
  const text = node('input');
  text.autocomplete = 'off';
  text.setAttribute('aria-label', 'Texto para o campo selecionado na OLX');
  text.placeholder = 'Toque no campo da OLX e digite aqui';
  text.type = 'password';
  const reveal = node('button', 'Mostrar texto');
  reveal.type = 'button';
  reveal.onclick = () => {
    text.type = text.type === 'password' ? 'text' : 'password';
  };
  const send = node('button', 'Inserir');
  typing.append(text, reveal, send);
  typing.onsubmit = async (event) => {
    event.preventDefault();
    if (text.value) {
      const value = text.value;
      try {
        await input({ action: 'text', text: value }, true);
        if (text.value === value) text.value = '';
      } catch {}
    }
  };
  const reply = node('form');
  reply.className = 'remote-reply';
  reply.hidden = true;
  const message = node('textarea');
  message.id = 'remoteMessage';
  message.rows = 2;
  message.placeholder = 'Escreva sua mensagem…';
  message.setAttribute('aria-label', 'Mensagem para o cliente');
  const sendMessage = node('button', 'Enviar');
  sendMessage.id = 'remoteSend';
  sendMessage.type = 'submit';
  sendMessage.onpointerdown = (event) => {
    if (document.activeElement === message) event.preventDefault();
  };
  const replyNotice = node('p');
  replyNotice.className = 'remote-reply-notice';
  replyNotice.setAttribute('role', 'status');
  replyNotice.setAttribute('aria-live', 'polite');
  reply.append(message, sendMessage, replyNotice);
  const drafts = new Map();
  let conversationKey = null,
    sending = false;
  message.onfocus = async () => {
    if (!conversationKey || sending || !remoteTarget) return;
    const key = conversationKey;
    try {
      const result = await input({ action: 'chat-check', conversationKey: key }, true);
      if (conversationKey === key)
        replyNotice.textContent = result.empty
          ? 'Campo da conversa pronto para responder.'
          : 'Há texto no campo da OLX. Confira o rascunho antes de enviar.';
      if (conversationKey === key && result.empty)
        document.getElementById('status').textContent = replyNotice.textContent;
    } catch (error) {
      if (conversationKey === key) replyNotice.textContent = error.message;
    }
  };
  reply.onsubmit = async (event) => {
    event.preventDefault();
    if (sending || !conversationKey || !message.value.trim()) return;
    if (!remoteTarget) {
      replyNotice.textContent = 'Aguarde a conversa carregar antes de enviar.';
      return;
    }
    const key = conversationKey,
      value = message.value;
    let draft = drafts.get(key);
    if (!draft || draft.text !== value) draft = { text: value, requestId: crypto.randomUUID() };
    drafts.set(key, draft);
    sending = true;
    sendMessage.disabled = true;
    sendMessage.textContent = 'Enviando…';
    replyNotice.textContent = '';
    try {
      const result = await input(
        { action: 'chat-send', conversationKey: key, text: value, requestId: draft.requestId },
        true,
      );
      if (result.confirmed) {
        drafts.delete(key);
        if (conversationKey === key && message.value === value) message.value = '';
      }
      if (conversationKey === key)
        replyNotice.textContent = result.confirmed
          ? 'Mensagem enviada ao chat.'
          : 'O envio não foi confirmado. Confira na conversa antes de tentar novamente.';
    } catch (error) {
      if (conversationKey === key) replyNotice.textContent = error.message;
    } finally {
      sending = false;
      sendMessage.disabled = !remoteTarget;
      sendMessage.textContent = 'Enviar';
    }
  };
  const keys = node('div');
  keys.className = 'remote-keys';
  for (const [label, key] of [
    ['Tab', 'Tab'],
    ['Apagar', 'Backspace'],
    ['Enter', 'Enter'],
    ['Esc', 'Escape'],
  ]) {
    const b = node('button', label);
    b.type = 'button';
    b.onclick = () => input({ action: 'key', key });
    keys.append(b);
  }
  for (const [label, delta] of [
    ['↑', -450],
    ['↓', 450],
  ]) {
    const b = node('button', label);
    b.onclick = () => input({ action: 'scroll', delta });
    keys.append(b);
  }
  const controls = node('details');
  controls.className = 'remote-extra';
  const summary = node('summary', 'Teclado e rolagem');
  controls.append(summary, keys);
  panel.append(toolbar, caption, stage, typing, reply, controls);
  document.querySelector('main').append(panel);
  const input = (command, strict = false) => {
    const payload = { target: remoteTarget, ...command };
    inputQueue = inputQueue
      .catch(() => {})
      .then(() => request('/api/input', payload))
      .catch((error) => {
        document.getElementById('status').textContent = error.message;
        if (strict) throw error;
      });
    return inputQueue;
  };
  back.onclick = () => {
    if (mode === 'unified' && hasView) {
      document.getElementById('unified').click();
      return;
    }
    panel.hidden = true;
    document.body.classList.remove('remote-open');
  };
  release.onclick = () =>
    request('/api/control/release', {}).then(() => {
      document.getElementById('status').textContent = 'Controle liberado para outro dispositivo.';
    });
  closePopup.onclick = () => input({ action: 'close-popup' });
  image.onclick = (event) => {
    const bounds = image.getBoundingClientRect();
    input({
      action: 'click',
      x: ((event.clientX - bounds.left) * image.naturalWidth) / bounds.width,
      y: ((event.clientY - bounds.top) * image.naturalHeight) / bounds.height,
    });
    image.focus();
  };
  image.onwheel = (event) => {
    event.preventDefault();
    input({ action: 'scroll', delta: Math.max(-1800, Math.min(1800, event.deltaY)) });
  };
  image.onkeydown = (event) => {
    event.preventDefault();
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey)
      input({ action: 'text', text: event.key });
    else
      input({
        action: 'key',
        key: event.key,
        control: event.ctrlKey || event.metaKey,
        shift: event.shiftKey,
      });
  };
  let touchY = 0;
  image.addEventListener(
    'touchstart',
    (e) => {
      touchY = e.touches[0].clientY;
    },
    { passive: true },
  );
  image.addEventListener(
    'touchend',
    (e) => {
      const delta = touchY - e.changedTouches[0].clientY;
      if (Math.abs(delta) > 35) {
        e.preventDefault();
        input({ action: 'scroll', delta: delta * 2 });
      }
    },
    { passive: false },
  );
  let mode = 'individual',
    hasView = false,
    lastViewport = '';
  function showRemote(state) {
    if (state.mode) mode = state.mode;
    if (state.hasView !== undefined) hasView = state.hasView;
    const profileChanged = state.profileId !== undefined && remoteProfile !== state.profileId;
    if (state.profileId !== undefined) remoteProfile = state.profileId;
    let nextKey = conversationKey;
    if (state.conversationKey !== undefined) nextKey = state.conversationKey || null;
    if (
      state.location === 'Chats unificados' ||
      state.mode === 'listings' ||
      state.mode === 'individual' ||
      state.hasView === false
    )
      nextKey = null;
    if (profileChanged || nextKey !== conversationKey) {
      remoteGeneration++;
      remoteTarget = 0;
      lastViewport = '';
      image.removeAttribute('src');
      sendMessage.disabled = true;
    }
    if (nextKey !== conversationKey) {
      if (conversationKey && message.value) {
        const before = drafts.get(conversationKey);
        if (!before || before.text !== message.value)
          drafts.set(conversationKey, { text: message.value, requestId: crypto.randomUUID() });
      }
      conversationKey = nextKey;
      message.value = drafts.get(nextKey)?.text || '';
      replyNotice.textContent = '';
    }
    reply.hidden = !conversationKey;
    typing.hidden = !!conversationKey;
    back.textContent = conversationKey ? '← Conversas' : '← Painel';
    caption.textContent = state.location || caption.textContent;
    if (state.profileId !== undefined || state.mode) {
      document.body.classList.remove('menu-open');
      menu.setAttribute('aria-expanded', 'false');
    }
    if (state.mode === 'listings' || state.location === 'Chats unificados') hasView = false;
    if (state.conversationKey || (state.mode === 'individual' && state.profileId)) hasView = true;
    panel.hidden = !hasView || mode === 'listings';
    document.body.classList.toggle('remote-open', !panel.hidden);
  }
  api.onState(showRemote);
  async function pollFrame() {
    if (busy || document.hidden || panel.hidden) return;
    busy = true;
    const generation = remoteGeneration;
    try {
      await ready;
      const response = await fetch('/api/frame');
      if (response.status === 401) {
        location.replace('/login');
        return;
      }
      if (!response.ok || response.status === 204) return;
      if (generation !== remoteGeneration) return;
      remoteTarget = Number(response.headers.get('X-Remote-Target'));
      const firstFrame = sendMessage.disabled && !sending;
      sendMessage.disabled = sending;
      closePopup.hidden = response.headers.get('X-Remote-Popup') !== '1';
      const blob = await response.blob();
      if (generation !== remoteGeneration) return;
      const next = URL.createObjectURL(blob);
      image.onload = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = next;
      };
      image.src = next;
      const width = Math.max(360, Math.min(1600, Math.round(stage.clientWidth))),
        height = Math.max(320, Math.min(1000, Math.round(stage.clientHeight)));
      const viewport = `${remoteTarget}:${width}:${height}`;
      if (lastViewport !== viewport) {
        lastViewport = viewport;
        await input({ action: 'viewport', width, height });
      }
      if (firstFrame && conversationKey && document.activeElement === message)
        await message.onfocus();
    } catch (error) {
      document.getElementById('status').textContent = 'Conexão interrompida. Tentando reconectar…';
    } finally {
      busy = false;
    }
  }
  ready.then((session) => {
    setTimeout(() => notify('browser:state', session.state), 0);
    stream = new EventSource('/api/events');
    stream.onmessage = (event) => {
      const { channel, state } = JSON.parse(event.data);
      notify(channel, state);
    };
    stream.onopen = () =>
      fetch('/api/session')
        .then((r) => {
          if (r.status === 401) {
            location.replace('/login');
            throw Error('Sessão expirada.');
          }
          return r.json();
        })
        .then((s) => {
          csrf = s.csrf;
          notify('browser:state', s.state);
          notify('listings:batch', s.batch);
        })
        .catch(() => {});
    stream.onerror = () => {
      document.getElementById('status').textContent = 'Reconectando ao servidor…';
      fetch('/api/session')
        .then((r) => {
          if (r.status === 401) location.replace('/login');
        })
        .catch(() => {});
    };
    setInterval(pollFrame, 650);
    pollFrame();
  });
})();
