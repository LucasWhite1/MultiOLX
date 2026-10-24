const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  safeStorage: nativeSafeStorage,
  protocol,
  net,
  dialog,
  nativeImage,
} = require('electron');
const fs = require('node:fs/promises');
const nativeFs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const {
  profileName,
  profileId,
  createProfile,
  allowedUrl,
  cookieForRestore,
} = require('./policy.cjs');
const {
  readChatDocument,
  activateChatDocument,
  conversationDocument,
  dismissAppPromotion,
  UnifiedInbox,
} = require('./inbox.cjs');
const { pageLimit, leastRecent } = require('./resources.cjs');
const { shouldDeferResource, backgroundCSS, restoreDeferredImages } = require('./economy.cjs');
const { createListingService } = require('./listing-service.cjs');
const { createDeepSeek } = require('./deepseek.cjs');
const { installComposerFocus } = require('./composer-focus.cjs');
const { marketplaceDocument } = require('./facebook-marketplace.cjs');
const facebookInboxUrl = 'https://www.facebook.com/marketplace/inbox/';
async function facebookCall(view, command) {
  const owner = profiles.find((p) => views.get(p.id) === view)?.id;
  command = { known: inbox.accounts.get(owner)?.rows || [], ...command };
  const result = await view.webContents.executeJavaScript(
    `(${marketplaceDocument.toString()})(${JSON.stringify(command)})`,
  );
  if (result.nativeClick) {
    const { x, y } = result.nativeClick;
    const bounds = view.getBounds();
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x >= bounds.width ||
      y >= bounds.height
    )
      throw Error('Controle Marketplace fora da área visível.');
    if (view === displayedView && win.isFocused()) view.webContents.focus();
    view.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    view.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    view.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    if (command.action === 'close') {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const remaining = await view.webContents.executeJavaScript(
        `(${marketplaceDocument.toString()})(${JSON.stringify(command)})`,
      );
      if (remaining.nativeClick)
        throw Error('Não foi possível confirmar o fechamento do chat Marketplace.');
    }
  }
  return result;
}
const webMode = process.env.MULTIOLX_WEB === '1';
const safeStorage = webMode
  ? require('./server-vault.cjs').createServerVault(process.env.MULTIOLX_ENCRYPTION_KEY)
  : nativeSafeStorage;
const webConfiguration = webMode ? require('./web-server.cjs').configuration() : null;
let webAccess, remoteBrowser;
let remoteConversation = null;
let initialization;
const remoteHandlers = new Map();
function registerHandler(name, handler) {
  ipcMain.handle(name, handler);
  remoteHandlers.set(name, handler);
}
function notify(channel, state) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, state);
  webAccess?.emit(channel, state);
}
let walkthroughOwner = null;
let listingService;
process.on('uncaughtExceptionMonitor', (error) => {
  try {
    nativeFs.appendFileSync(
      path.resolve('artifacts/browser-runtime-errors.log'),
      String(error.stack || error) + '\n',
    );
  } catch {}
});

app.setName('MultiOLX Browser');
if (process.platform === 'win32') app.setAppUserModelId('br.multiolx.browser');
app.enableSandbox();
// Use Chromium's user-namespace sandbox in the VPS container; the legacy SUID helper is not used.
if (webMode && process.platform === 'linux') app.commandLine.appendSwitch('disable-setuid-sandbox');
// A private app directory; never open, edit or copy a personal Chrome profile.
const root = require('./data-directory.cjs').dataDirectory({
  home: app.getPath('home'),
  appData: app.getPath('appData'),
  localAppData: process.env.LOCALAPPDATA,
}).root;
nativeFs.mkdirSync(root, { recursive: true, mode: 0o700 });
app.setPath('userData', root);
app.setPath('sessionData', root);
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'multiolx-browser',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const sessions = new Map(),
  views = new Map(),
  chatViews = new Map(),
  popups = new Map();
const inbox = new UnifiedInbox();
const facebookWindows = new Map();
function parkFacebookView(view) {
  if (profiles.find((p) => views.get(p.id) === view)?.provider !== 'facebook') return;
  let worker = facebookWindows.get(view);
  if (!worker) {
    const window = new BrowserWindow({
      x: -30000,
      y: -30000,
      width: 1100,
      height: 800,
      show: false,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: { ...preferences },
    });
    worker = { window, attached: false };
    facebookWindows.set(view, worker);
    view.webContents.once('destroyed', () => {
      facebookWindows.delete(view);
      if (!window.isDestroyed()) window.destroy();
    });
  }
  if (!worker.attached) {
    worker.window.contentView.addChildView(view);
    worker.attached = true;
  }
  view.setBounds({ x: 0, y: 0, width: 1100, height: 800 });
  view.webContents.setBackgroundThrottling(false);
  worker.window.showInactive();
}
function unparkFacebookView(view) {
  const worker = facebookWindows.get(view);
  if (worker?.attached) {
    worker.window.contentView.removeChildView(view);
    worker.attached = false;
    worker.window.hide();
  }
}
const touched = new Map(),
  dirtySessions = new Set(),
  cookieDigests = new Map();
let economy = true,
  maxPages = 2,
  pageQueue = Promise.resolve(),
  scanQueue = [],
  scanning = false,
  scanCursor = 0,
  lastScan = 0,
  inboxKey = '',
  inboxDirty = false,
  verifiedConversation = false,
  foregroundId = null;
let displayedView = null,
  mode = 'individual',
  inboxTimer;
let healthKey = '',
  proofSaved = false;
let win,
  active,
  profiles = [],
  removedProfiles = [],
  quitting = false,
  saveTimer,
  snapshotQueue = Promise.resolve(),
  catalogQueue = Promise.resolve();
const localOrigin = 'multiolx-browser://app';
const selfTest =
  process.argv.includes('--self-test') || process.argv.includes('--self-test-restore');
const preferences = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
};
const send = (state) => {
  notify('browser:state', { ...state, hasView: !!displayedView });
};
function trusted(event) {
  if (
    !win ||
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame ||
    !event.senderFrame.url.startsWith(localOrigin + '/')
  )
    throw new Error('Operação não autorizada.');
}
async function atomic(file, bytes) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temporary, bytes, { mode: 0o600 });
  try {
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
function saveCatalog() {
  catalogQueue = catalogQueue
    .catch(() => {})
    .then(() =>
      atomic(path.join(root, 'profiles.json'), JSON.stringify([...profiles, ...removedProfiles])),
    );
  return catalogQueue;
}
function secureStorage() {
  return (
    safeStorage.isEncryptionAvailable() &&
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  );
}
async function saveCookies(id, ses) {
  if (!secureStorage())
    throw new Error(
      'O cofre do sistema está indisponível. Cookies de sessão não foram exportados.',
    );
  const cookies = await ses.cookies.get({});
  const encoded = JSON.stringify(cookies);
  if (cookieDigests.get(id) === encoded) {
    dirtySessions.delete(id);
    return;
  }
  await atomic(path.join(root, `session-${id}.enc`), safeStorage.encryptString(encoded));
  await ses.cookies.flushStore();
  ses.flushStorageData();
  cookieDigests.set(id, encoded);
  dirtySessions.delete(id);
}
async function openSession(id) {
  if (sessions.has(id)) return sessions.get(id);
  if (!secureStorage())
    throw new Error('Ative o cofre de credenciais do sistema antes de abrir um perfil.');
  const ses = session.fromPartition(`persist:account-${profileId(id)}`);
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((details, callback) => {
    const view = views.get(id);
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed() || quitting) {
      callback({ cancel: false });
      return;
    }
    const cancel = shouldDeferResource(
      { ...details, frameUrl: details.frame?.url },
      {
        enabled: economy,
        background: view !== displayedView && details.webContentsId === contents.id,
        chatDocument: contents.getURL().startsWith('https://chat.olx.com.br/'),
      },
    );
    callback({ cancel });
  });
  ses.on('will-download', (event) => {
    event.preventDefault();
    send({ message: 'Downloads ainda não estão disponíveis neste navegador.' });
  });
  try {
    const cookies = JSON.parse(
      safeStorage.decryptString(await fs.readFile(path.join(root, `session-${id}.enc`))),
    );
    for (const cookie of cookies) {
      if (!cookie.session && cookie.expirationDate < Date.now() / 1000) continue;
      // The browser's own newer persistent state is authoritative after a crash.
      const current = await ses.cookies.get({ name: cookie.name, domain: cookie.domain });
      if (current.some((c) => c.domain === cookie.domain && c.path === cookie.path)) continue;
      await ses.cookies.set(cookieForRestore(cookie));
    }
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error('Não foi possível restaurar a sessão. A cópia anterior foi preservada.');
  }
  sessions.set(id, ses);
  dirtySessions.add(id);
  ses.cookies.on('changed', () => dirtySessions.add(id));
  return ses;
}
function bindRemote(contents, id) {
  contents.on('before-input-event', (event, input) => {
    if (
      input.type !== 'keyDown' ||
      input.key !== 'Escape' ||
      input.control ||
      input.alt ||
      input.meta
    )
      return;
    if (
      mode !== 'unified' ||
      foregroundId ||
      profileDialogOpen ||
      displayedView?.webContents !== contents ||
      !hasOpenConversation(displayedView)
    )
      return;
    event.preventDefault();
    void showUnifiedInbox().catch((error) => send({ message: error.message, error: true }));
  });
  const guard = (event, legacyUrl, _sameDocument, legacyMainFrame) => {
    if (event.isMainFrame === false || legacyMainFrame === false) return;
    const url = event.url || legacyUrl;
    if (!allowedUrl(url, profiles.find((p) => p.id === id)?.provider)) {
      event.preventDefault();
      send({ message: 'Este destino não pertence à plataforma deste perfil.', error: true });
    }
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.setWindowOpenHandler(({ url }) => {
    if (!allowedUrl(url, profiles.find((p) => p.id === id)?.provider)) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 920,
        height: 760,
        parent: win,
        webPreferences: { ...preferences, session: sessions.get(id) },
      },
    };
  });
  contents.on('did-create-window', (popup) => {
    popups.set(popup, id);
    popup.on('closed', () => popups.delete(popup));
    bindRemote(popup.webContents, id);
  });
  contents.on('did-finish-load', () => {
    if (active === id)
      send({
        location: publicLocation(contents.getURL()),
        back: contents.navigationHistory.canGoBack(),
        forward: contents.navigationHistory.canGoForward(),
        message: 'Página carregada. Confirme o login diretamente no site.',
      });
  });
  contents.on('did-fail-load', (_event, code, _description, _url, isMain) => {
    if (isMain && code !== -3)
      send({
        message: 'A página não carregou. Confira a conexão ou a resposta do site.',
        error: true,
      });
  });
}
const visualQueues = new WeakMap();
function updateVisuals(view) {
  const contents = view.webContents;
  const next = (visualQueues.get(view) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      if (contents.isDestroyed()) return;
      const background =
        economy &&
        view !== displayedView &&
        contents.getURL().startsWith('https://chat.olx.com.br/');
      if (background && !view.economyCSS) view.economyCSS = await contents.insertCSS(backgroundCSS);
      if (!background) {
        if (view.economyCSS) await contents.removeInsertedCSS(view.economyCSS).catch(() => {});
        view.economyCSS = null;
        await contents.executeJavaScript(`(${restoreDeferredImages.toString()})()`).catch(() => {});
      }
    });
  visualQueues.set(view, next);
  void next.catch(() => {});
  return next;
}
let profileDialogOpen = false;
function hasOpenConversation(view) {
  const entry = [...chatViews.values()].find((entry) => entry.view === view);
  if (!entry || view.webContents.isDestroyed()) return false;
  const url = new URL(view.webContents.getURL() || 'about:blank');
  return (
    entry.conversationOpen ||
    (url.hostname === 'chat.olx.com.br' && url.searchParams.has('chat-id'))
  );
}
function resetConversation(view) {
  const pair = [...chatViews].find(([, entry]) => entry.view === view);
  const facebook = profiles.find((p) => views.get(p.id) === view)?.provider === 'facebook';
  if (!pair)
    return facebook ? facebookCall(view, { action: 'close' }).catch(() => {}) : Promise.resolve();
  const [id, entry] = pair;
  if (entry.returning) return entry.returning;
  if (!facebook && !hasOpenConversation(view)) return Promise.resolve();
  entry.conversationOpen = false;
  entry.generation = (entry.generation || 0) + 1;
  entry.openDeadline = 0;
  entry.listHistoryIndex = undefined;
  entry.stopped = false;
  inbox.update(id, { status: 'LOADING' });
  // Reload the list route to unmount the conversation and its live read receipts.
  // Hiding the native view alone leaves the OLX conversation subscribed.
  entry.returning = (
    facebook
      ? facebookCall(view, { action: 'close' })
      : view.webContents.loadURL('https://chat.olx.com.br/')
  )
    .catch(async () => {
      if (chatViews.get(id) !== entry) return;
      if (!view.webContents.isDestroyed())
        await view.webContents.loadURL('about:blank').catch(() => {});
      if (chatViews.get(id) === entry) {
        inbox.update(id, { status: 'ERROR' });
        entry.stopped = true;
      }
    })
    .finally(async () => {
      entry.returning = null;
      await readInbox(id);
    });
  return entry.returning;
}
async function showUnifiedInbox() {
  remoteConversation = null;
  mode = 'unified';
  active = null;
  const closing = display(null);
  send({
    mode,
    profileId: null,
    source: '',
    location: 'Chats unificados',
    back: false,
    forward: false,
  });
  await closing;
  await Promise.all(
    [...chatViews.values()].map((entry) => entry.returning || resetConversation(entry.view)),
  );
  if (!selfTest) void refreshInbox();
  return inboxState();
}
function display(view) {
  const previous = displayedView;
  if (previous !== view) remoteConversation = null;
  const closing = previous && previous !== view ? resetConversation(previous) : Promise.resolve();
  if (displayedView) {
    displayedView.webContents.setBackgroundThrottling(
      profiles.find((p) => views.get(p.id) === displayedView)?.provider !== 'facebook',
    );
    win.contentView.removeChildView(displayedView);
    displayedView.setBounds({ x: 0, y: 0, width: 1100, height: 800 });
    if (displayedView !== view) parkFacebookView(displayedView);
  }
  displayedView = view;
  if (previous) void updateVisuals(previous);
  if (view) {
    unparkFacebookView(view);
    view.setVisible(!profileDialogOpen);
    view.webContents.setBackgroundThrottling(false);
    win.contentView.addChildView(view);
    resize();
    void updateVisuals(view);
  }
  return closing;
}
function inboxState() {
  const state = {
    ...inbox.state(profiles),
    resources: { activePages: views.size, limit: maxPages, profiles: profiles.length, economy },
  };
  state.accounts = state.accounts.map((account) =>
    profiles.find((p) => p.id === account.id)?.provider === 'facebook'
      ? {
          ...account,
          message:
            account.status === 'READY'
              ? 'Marketplace disponível'
              : account.status === 'AUTH_REQUIRED'
                ? 'Entre no Facebook neste perfil'
                : account.message,
        }
      : account,
  );
  return state;
}
function publishInbox() {
  if (win && !win.isDestroyed()) {
    const state = inboxState();
    const signature = JSON.stringify({
      ...state,
      accounts: state.accounts.map(({ observedAt, ...a }) => a),
    });
    if (signature !== inboxKey) {
      inboxKey = signature;
      inboxDirty = true;
      notify('inbox:state', state);
    }
    if (
      process.argv.includes('--verify-conversation') &&
      !verifiedConversation &&
      state.conversations.length &&
      state.accounts.every((a) => a.status !== 'LOADING')
    ) {
      verifiedConversation = true;
      setTimeout(
        () =>
          void openConversation(state.conversations[0].key)
            .then(async () => {
              const until = Date.now() + 15000;
              let check;
              do {
                await new Promise((resolve) => setTimeout(resolve, 300));
                check = await displayedView.webContents.executeJavaScript(
                  `(${conversationDocument.toString()})()`,
                );
              } while (!check.composer && Date.now() < until);
              console.log(
                'MULTIOLX_CHAT_VERIFY ' +
                  JSON.stringify({
                    method: 'native-list-click',
                    composer: check.composer,
                    skeletons: check.skeletons,
                    pages: views.size,
                    limit: maxPages,
                  }),
              );
              await new Promise((resolve) => setTimeout(resolve, 4500));
              await fs.writeFile(
                path.resolve('artifacts/browser-conversation-content.png'),
                (await displayedView.webContents.capturePage()).toPNG(),
              );
              await fs.writeFile(
                path.resolve('artifacts/browser-conversation-live.png'),
                (await win.capturePage()).toPNG(),
              );
            })
            .catch((error) => console.log('MULTIOLX_CHAT_VERIFY_FAILED ' + error.message)),
        1000,
      );
    }
    if (process.argv.includes('--inbox-report')) {
      const summary = state.accounts.map(({ name, status, count }) => ({ name, status, count })),
        key = JSON.stringify(summary);
      if (key !== healthKey) {
        healthKey = key;
        console.log('MULTIOLX_INBOX_STATUS ' + key);
      }
      if (
        !proofSaved &&
        summary.length &&
        summary.every((a) => a.status === 'READY') &&
        mode === 'unified' &&
        !displayedView
      ) {
        proofSaved = true;
        setTimeout(() => {
          if (!win.isDestroyed())
            void win.webContents
              .capturePage()
              .then((img) =>
                fs.writeFile(path.resolve('artifacts/browser-unified-live.png'), img.toPNG()),
              )
              .catch(() => {});
        }, 500);
      }
    }
  }
}
async function readInbox(id) {
  const entry = chatViews.get(id);
  if (
    !entry ||
    entry.returning ||
    entry.busy ||
    entry.stopped ||
    entry.view.webContents.isDestroyed()
  )
    return;
  if (
    entry.view.webContents.isLoadingMainFrame() &&
    !entry.view.webContents.getURL().startsWith('https://chat.olx.com.br/') &&
    !entry.view.webContents.getURL().startsWith('https://www.facebook.com/marketplace/inbox') &&
    !entry.view.webContents.getURL().startsWith('https://www.facebook.com/messages/marketplace')
  )
    return;
  entry.busy = true;
  const generation = entry.generation || 0;
  entry.lastRead = Date.now();
  try {
    const facebook = profiles.find((p) => p.id === id)?.provider === 'facebook';
    const result = facebook
      ? await facebookCall(entry.view, {
          action: 'read',
          ensure: entry.view !== displayedView || entry.initializing,
        })
      : await entry.view.webContents.executeJavaScript(`(${readChatDocument.toString()})()`);
    if (facebook)
      entry.facebookDiagnostic = {
        ...(result.diagnostic || {}),
        status: result.status,
        url: publicLocation(entry.view.webContents.getURL()),
      };
    if (result.status === 'OPENING' && entry.openDeadline && Date.now() > entry.openDeadline)
      result.status = 'TIMEOUT';
    if (chatViews.get(id) !== entry || entry.returning || generation !== (entry.generation || 0))
      return;
    if (facebook && result.status === 'READY') {
      entry.initializing = false;
      entry.facebookRows ||= new Map(
        (inbox.accounts.get(id)?.rows || []).map((row) => [row.externalId, row]),
      );
      if (!result.partial) entry.facebookRows.clear();
      for (const row of result.conversations) {
        if (/^\d+$/.test(row.externalId)) {
          for (const [key, cached] of entry.facebookRows)
            if (
              key.startsWith('marketplace-') &&
              cached.contact === row.contact &&
              cached.listingTitle === row.listingTitle
            )
              entry.facebookRows.delete(key);
        }
        entry.facebookRows.set(row.externalId, row);
      }
      result.conversations = [...entry.facebookRows.values()].slice(0, 200);
      if (
        entry.view === displayedView &&
        win.isFocused() &&
        result.openConversations > 0 &&
        entry.facebookSelectedId
      )
        result.conversations = result.conversations.map((row) =>
          row.externalId === entry.facebookSelectedId
            ? { ...row, unread: false, unreadCount: null }
            : row,
        );
      if (entry.view === displayedView) entry.conversationOpen = result.openConversations > 0;
    }
    if (result.detail)
      result.detail.viewed =
        entry.view === displayedView && win.isVisible() && !win.isMinimized() && win.isFocused();
    inbox.update(id, result);
    if (['BLOCKED', 'LAYOUT_CHANGED', 'AUTH_REQUIRED'].includes(result.status))
      entry.stopped = true;
  } catch {
    if (chatViews.get(id) !== entry || entry.returning || generation !== (entry.generation || 0))
      return;
    inbox.update(id, { status: 'ERROR' });
    entry.stopped = true;
  } finally {
    entry.busy = false;
    publishInbox();
  }
}
async function releasePage(id) {
  const view = views.get(id);
  if (!view) return;
  if (view === displayedView) throw new Error('O perfil em uso não pode entrar em espera.');
  await saveCookies(id, sessions.get(id));
  chatViews.delete(id);
  views.delete(id);
  touched.delete(id);
  view.webContents.close();
  inbox.update(id, { status: 'PAUSED' });
  publishInbox();
}
function acquirePage(id) {
  const next = pageQueue
    .catch(() => {})
    .then(async () => {
      if (!profiles.some((p) => p.id === id)) throw new Error('Perfil não encontrado.');
      if (views.has(id)) {
        if (chatViews.get(id)?.returning) await chatViews.get(id).returning;
        touched.set(id, Date.now());
        return views.get(id);
      }
      while (views.size >= maxPages) {
        const protectedIds = new Set(
          [...views].filter(([, v]) => v === displayedView).map(([key]) => key),
        );
        if (foregroundId) protectedIds.add(foregroundId);
        for (const owner of views.keys())
          if (listingService?.ownsPage(owner)) protectedIds.add(owner);
        for (const owner of popups.values()) protectedIds.add(owner);
        const victim =
          leastRecent(
            [...views.keys()].filter(
              (owner) => profiles.find((p) => p.id === owner)?.provider !== 'facebook',
            ),
            touched,
            protectedIds,
          ) || leastRecent([...views.keys()], touched, protectedIds);
        if (!victim) throw new Error('Conclua as janelas de login antes de abrir outro perfil.');
        await releasePage(victim);
      }
      const ses = await openSession(id);
      if (!profiles.some((p) => p.id === id)) throw new Error('Perfil não encontrado.');
      const view = new WebContentsView({
        webPreferences: { ...preferences, session: ses, backgroundThrottling: true },
      });
      view.setBounds({ x: 0, y: 0, width: 1100, height: 800 });
      views.set(id, view);
      parkFacebookView(view);
      touched.set(id, Date.now());
      bindRemote(view.webContents, id);
      view.webContents.on('dom-ready', () => {
        view.economyCSS = null;
        void view.webContents
          .executeJavaScript(`(${installComposerFocus.toString()})()`)
          .catch(() => {});
        void updateVisuals(view);
        void readInbox(id);
      });
      view.webContents.on('did-finish-load', () => void readInbox(id));
      return view;
    });
  pageQueue = next;
  return next;
}
async function ensureChat(id, retry = false) {
  if (listingService?.isWorker(id)) throw new Error('Esta conta está publicando.');
  profileId(id);
  if (!profiles.some((p) => p.id === id)) throw new Error('Perfil não encontrado.');
  let entry = chatViews.get(id);
  if (entry) {
    if (entry.returning) await entry.returning;
    if (retry) entry.stopped = false;
    if (
      retry &&
      profiles.find((p) => p.id === id)?.provider === 'facebook' &&
      !entry.view.webContents.getURL().startsWith('https://www.facebook.com/marketplace/inbox') &&
      !entry.view.webContents.getURL().startsWith('https://www.facebook.com/messages/marketplace')
    ) {
      entry.initializing = true;
      void entry.view.webContents.loadURL(facebookInboxUrl).catch(() => {});
    }
    if (retry && entry.view.webContents.getURL().startsWith('https://conta.olx.com.br/')) {
      entry.stopped = false;
      void entry.view.webContents.loadURL('https://chat.olx.com.br/').catch(() => {});
    }
    await readInbox(id);
    return entry.view;
  }
  const view = await acquirePage(id);
  if (listingService?.isWorker(id)) throw new Error('Esta conta está publicando.');
  if (!profiles.some((p) => p.id === id)) throw new Error('Perfil não encontrado.');
  if (chatViews.has(id)) return chatViews.get(id).view;
  if (profiles.find((p) => p.id === id)?.provider === 'facebook')
    view.webContents.setBackgroundThrottling(false);
  entry = {
    view,
    busy: false,
    stopped: false,
    lastRead: 0,
    startedAt: Date.now(),
    initializing: true,
  };
  chatViews.set(id, entry);
  inbox.update(id, { status: 'LOADING' });
  publishInbox();
  void view.webContents
    .loadURL(
      profiles.find((p) => p.id === id).provider === 'facebook'
        ? facebookInboxUrl
        : 'https://chat.olx.com.br/',
    )
    .then(() => readInbox(id))
    .catch((error) => {
      if (error?.code === 'ERR_ABORTED' || chatViews.get(id) !== entry) return;
      inbox.update(id, { status: 'ERROR' });
      entry.stopped = true;
      publishInbox();
    });
  return view;
}
async function refreshInbox() {
  queueScan(
    profiles.map((p) => p.id),
    true,
  );
  publishInbox();
  return inboxState();
}
function queueScan(ids, retry = false) {
  for (const id of ids)
    if (!scanQueue.some((item) => item.id === id)) scanQueue.push({ id, retry });
  if (!scanning) void scanProfiles();
}
async function scanProfiles() {
  scanning = true;
  try {
    while (scanQueue.length && !quitting) {
      const { id, retry } = scanQueue.shift();
      if (id === walkthroughOwner) continue;
      if (listingService?.ownsPage(id)) continue;
      const existing = views.get(id);
      if (existing === displayedView && !chatViews.has(id)) continue;
      try {
        const view = await ensureChat(id, retry),
          until =
            Date.now() +
            (profiles.find((p) => p.id === id)?.provider === 'facebook' ? 25000 : 12000);
        while (Date.now() < until && chatViews.get(id)?.view === view && !quitting) {
          await readInbox(id);
          if (inbox.accounts.get(id)?.status !== 'LOADING') break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (inbox.accounts.get(id)?.status === 'LOADING' && chatViews.get(id)?.view === view) {
          inbox.update(id, { status: 'TIMEOUT' });
          chatViews.get(id).stopped = true;
          publishInbox();
        }
        if (
          profiles.find((p) => p.id === id)?.provider === 'facebook' &&
          inbox.accounts.get(id)?.status === 'READY' &&
          view !== displayedView &&
          foregroundId !== id
        ) {
          for (
            let step = 0;
            step < 12 &&
            view !== displayedView &&
            foregroundId !== id &&
            chatViews.get(id)?.view === view;
            step++
          ) {
            const scroll = await facebookCall(view, { action: 'scroll' });
            if (!scroll.moved) break;
            await new Promise((resolve) => setTimeout(resolve, 250));
            await readInbox(id);
          }
          if (view !== displayedView && chatViews.get(id)?.view === view)
            await facebookCall(view, { action: 'scroll', top: true });
        }
      } catch {
        inbox.update(id, { status: 'ERROR' });
        publishInbox();
      }
    }
  } finally {
    scanning = false;
  }
}
async function waitForList(id, ms = 12000) {
  const view = await ensureChat(id);
  if (hasOpenConversation(view)) await resetConversation(view);
  const until = Date.now() + ms;
  const entry = chatViews.get(id);
  if (
    ['DETAIL', 'OPENING'].includes(inbox.accounts.get(id)?.status) &&
    Number.isInteger(entry.listHistoryIndex) &&
    entry.listHistoryIndex !== view.webContents.navigationHistory.getActiveIndex()
  )
    view.webContents.navigationHistory.goToIndex(entry.listHistoryIndex);
  while (Date.now() < until) {
    await readInbox(id);
    const status = inbox.accounts.get(id)?.status;
    if (status === 'READY') return view;
    if (['BLOCKED', 'AUTH_REQUIRED', 'ERROR', 'LAYOUT_CHANGED', 'TIMEOUT'].includes(status)) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('O chat não ficou disponível. Abra o perfil para conferir o login ou a conexão.');
}
async function openConversation(key) {
  remoteConversation = null;
  if (listingService?.batchActive())
    throw new Error('Aguarde a publicação antes de abrir conversas.');
  if (typeof key !== 'string' || key.length > 1200) throw new Error('Conversa inválida.');
  const conversation = inbox.find(key, profiles);
  if (!conversation) throw new Error('Conversa não encontrada. Atualize a lista.');
  // A SPA conversation is opened through its native row. Reloading the full
  // ?chat-id URL discards the running chat client and can leave a skeleton.
  foregroundId = conversation.profileId;
  try {
    const view = await waitForList(conversation.profileId);
    mode = 'unified';
    active = conversation.profileId;
    send({ source: conversation.profileName });
    display(view);
    touched.set(conversation.profileId, Date.now());
    chatViews.get(conversation.profileId).listHistoryIndex =
      view.webContents.navigationHistory.getActiveIndex();
    chatViews.get(conversation.profileId).openDeadline = Date.now() + 15000;
    chatViews.get(conversation.profileId).conversationOpen = true;
    const facebook = profiles.find((p) => p.id === conversation.profileId)?.provider === 'facebook';
    let result;
    if (facebook) {
      result = await facebookCall(view, { action: 'open', id: conversation.externalId });
      for (let step = 0; !result.clicked && step < 16; step++) {
        const scroll = result.switched
          ? { moved: true }
          : await facebookCall(view, { action: 'scroll', top: step === 0 });
        if (!scroll.moved && step > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
        result = await facebookCall(view, { action: 'open', id: conversation.externalId });
      }
      if (result.clicked)
        chatViews.get(conversation.profileId).facebookSelectedId = conversation.externalId;
    } else
      result = await view.webContents.executeJavaScript(
        `(${activateChatDocument.toString()})(${JSON.stringify(conversation.externalId)})`,
      );
    if (!result.clicked)
      throw new Error(
        'A conversa saiu da lista visível. Atualize o chat individual antes de tentar novamente.',
      );
    remoteConversation = {
      key,
      profileId: conversation.profileId,
      url: conversation.url,
      contact: conversation.contact,
      platform: conversation.platform,
    };
    for (const delay of [500, 1800, 4000])
      setTimeout(() => {
        if (views.get(conversation.profileId) === view && !view.webContents.isDestroyed())
          void view.webContents
            .executeJavaScript(`(${dismissAppPromotion.toString()})()`)
            .catch(() => {});
      }, delay);
    for (const delay of [700, 2200, 4500])
      setTimeout(() => void readInbox(conversation.profileId), delay);
    send({
      mode,
      conversationKey: key,
      profileId: conversation.profileId,
      location: `${conversation.profileName} · ${conversation.contact}`,
      back: view.webContents.navigationHistory.canGoBack(),
      forward: view.webContents.navigationHistory.canGoForward(),
      message: `Conversa aberta na conta ${conversation.profileName}.`,
    });
    return { profileId: conversation.profileId, key };
  } finally {
    foregroundId = null;
  }
}
function publicLocation(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return '';
  }
}
function resize() {
  if (webMode) {
    if (displayedView) displayedView.setBounds({ x: 0, y: 0, width: 1100, height: 780 });
    return;
  }
  if (displayedView) {
    const [width, height] = win.getContentSize();
    const focusChat = mode === 'unified' && width < 1500;
    const x = mode === 'unified' && !focusChat ? 584 : 232;
    const isChat = [...chatViews.values()].some((entry) => entry.view === displayedView);
    displayedView.webContents.setZoomFactor(isChat ? Math.min(1, (width - x) / 1100) : 1);
    displayedView.setBounds({
      x,
      y: 120,
      width: Math.max(0, width - x),
      height: Math.max(0, height - 152),
    });
    send({ focusChat });
  }
}
async function connectFacebook() {
  let profile = profiles.find((p) => p.provider === 'facebook');
  if (!profile) {
    profile = createProfile('Facebook Marketplace', 'facebook');
    profiles.push(profile);
    try {
      await saveCatalog();
    } catch (error) {
      profiles.pop();
      throw error;
    }
  }
  await open(profile.id);
  send({
    mode: 'individual',
    profileId: profile.id,
    source: profile.name,
    message:
      'Facebook Marketplace: faça login se necessário. Somente a pasta Marketplace é incluída nos chats unificados.',
  });
  return profile;
}
async function open(id) {
  if (listingService?.isWorker(id))
    throw new Error('Esta conta está publicando. Aguarde a conclusão.');
  profileId(id);
  if (!profiles.some((p) => p.id === id)) throw new Error('Perfil não encontrado.');
  const view = await acquirePage(id);
  mode = 'individual';
  active = id;
  display(view);
  if (view.webContents.getURL() === '') {
    const facebook = profiles.find((p) => p.id === id).provider === 'facebook';
    const loading = view.webContents.loadURL(
      facebook ? facebookInboxUrl : 'https://www.olx.com.br/',
    );
    if (facebook)
      void loading.catch(() =>
        send({
          message: 'Confira a conexão do Facebook ou conclua a verificação na página.',
          error: true,
        }),
      );
    else await loading;
  }
  send({
    mode: 'individual',
    source: profiles.find((p) => p.id === id).name,
    location: publicLocation(view.webContents.getURL()),
    message: `Perfil ${profiles.find((p) => p.id === id).name} aberto.`,
    back: view.webContents.navigationHistory.canGoBack(),
    forward: view.webContents.navigationHistory.canGoForward(),
  });
}
function flushAll(force = false) {
  snapshotQueue = snapshotQueue
    .catch(() => {})
    .then(async () => {
      if (force && !selfTest && win && !win.isDestroyed())
        await win.webContents.executeJavaScript('window.multiListings?.save()');
      if (listingService) await listingService.wait();
      for (const [id, ses] of sessions)
        if (force || dirtySessions.has(id)) await saveCookies(id, ses);
      if ((force || inboxDirty) && secureStorage()) {
        await atomic(
          path.join(root, 'inbox.enc'),
          safeStorage.encryptString(JSON.stringify(inbox.export())),
        );
        inboxDirty = false;
      }
    });
  return snapshotQueue;
}
async function start() {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  try {
    profiles = JSON.parse(await fs.readFile(path.join(root, 'profiles.json'), 'utf8'));
    if (
      !Array.isArray(profiles) ||
      profiles.some((p) => profileId(p.id) !== p.id || profileName(p.name) !== p.name)
    )
      throw new Error('Catálogo inválido.');
    removedProfiles = profiles.filter((p) => typeof p.removedAt === 'string');
    profiles = profiles.filter((p) => !p.removedAt);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    const settings = JSON.parse(await fs.readFile(path.join(root, 'settings.json'), 'utf8'));
    maxPages = pageLimit(settings.maxPages);
    economy = settings.economy !== false;
  } catch (error) {
    if (error.code !== 'ENOENT') maxPages = 2;
  }
  try {
    if (secureStorage())
      inbox.restore(
        JSON.parse(safeStorage.decryptString(await fs.readFile(path.join(root, 'inbox.enc')))),
        profiles,
      );
  } catch {}
  protocol.handle('multiolx-browser', (request) => {
    const url = new URL(request.url),
      files = new Set(['index.html', 'style.css', 'ui.js', 'listing-ui.js']);
    const name = url.pathname.slice(1);
    if (url.hostname !== 'app' || !files.has(name))
      return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(__dirname, name)).href);
  });
  win = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: webMode ? 360 : 1000,
    minHeight: webMode ? 320 : 650,
    show: false,
    title: 'MultiOLX Browser',
    webPreferences: {
      ...preferences,
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: webMode ? ['--multiolx-server-shell'] : [],
    },
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('resize', resize);
  const listingAI = createDeepSeek({ root, atomic, safeStorage, secureStorage });
  if (!selfTest) await listingAI.restore();
  listingService = createListingService({
    ai: listingAI,
    parallelLimit: () => maxPages,
    batchChanged: (state) => {
      if (win && !win.isDestroyed()) notify('listings:batch', state);
    },
    publisherStatus: (message) => send({ message }),
    root,
    atomic,
    safeStorage,
    secureStorage,
    ipcMain: { handle: registerHandler },
    dialog,
    nativeImage,
    trusted,
    profiles: () => profiles.filter((p) => p.provider !== 'facebook'),
    removedProfiles: () => removedProfiles.map((p) => p.id),
    window: () => win,
    publisherActive: (owner, contents) =>
      active === owner && displayedView?.webContents === contents,
    focusPublisher: async (owner, contents) => {
      const view = views.get(owner);
      if (!view || view.webContents !== contents)
        throw new Error('O formulário anterior foi fechado. Confira seu resultado na OLX.');
      active = owner;
      mode = 'individual';
      display(view);
      send({
        mode,
        profileId: owner,
        source: profiles.find((p) => p.id === owner).name,
        location: 'Preparar anúncio',
      });
    },
    showWorkspace: () => {
      mode = 'listings';
      active = null;
      display(null);
      send({
        mode,
        profileId: null,
        source: '',
        location: 'Anúncios',
        back: false,
        forward: false,
      });
    },
    openPublisher: async (owner, listing, { background = false, url } = {}) => {
      if (!profiles.some((p) => p.id === owner)) throw new Error('Conta não encontrada.');
      if (!background) foregroundId = owner;
      try {
        const view = await acquirePage(owner);
        if (background) view.webContents.setBackgroundThrottling(false);
        chatViews.delete(owner);
        inbox.update(owner, { status: 'PAUSED' });
        publishInbox();
        if (!background) {
          active = owner;
          mode = 'individual';
          display(view);
          send({
            mode,
            profileId: owner,
            source: profiles.find((p) => p.id === owner).name,
            location: 'Preparar anúncio',
            back: false,
            forward: false,
          });
        }
        await view.webContents.loadURL(url || 'https://www2.olx.com.br/desapega');
        if (url) return view.webContents;
        const until = Date.now() + 12000;
        do {
          const clicked = await view.webContents.executeJavaScript(
            `(() => {const button=[...document.querySelectorAll('button')].find(n=>/^Começar meu anúncio$/i.test(n.innerText.trim()));if(!button)return false;button.click();return true;})()`,
          );
          if (clicked) break;
          if (
            await view.webContents.executeJavaScript(
              'Boolean(document.querySelector(\'input[name=subject],input[name=title],#subject,button[aria-label^="Selecionar categoria "]\'))',
            )
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        } while (Date.now() < until);
        for (let attempt = 0; attempt < 30; attempt++) {
          const selected = await view.webContents.executeJavaScript(
            `(() => { const button=[...document.querySelectorAll('button')].find(n=>n.getAttribute('aria-label')===${JSON.stringify('Selecionar categoria ')}+${JSON.stringify(listing.group || 'Produtos')});if(!button)return false;button.click();return true; })()`,
          );
          if (selected) break;
          if (
            await view.webContents.executeJavaScript(
              "Boolean(document.querySelector('#subject,input[name=title]'))",
            )
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return view.webContents;
      } finally {
        if (!background) foregroundId = null;
      }
    },
  });
  await listingService.restore();
  win.on('focus', () => {
    if (active) void readInbox(active);
  });
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      app.quit();
    }
  });
  registerHandler('profiles:list', (event) => {
    trusted(event);
    return profiles;
  });
  registerHandler('profiles:create', async (event, name) => {
    trusted(event);
    const profile = createProfile(name);
    profiles.push(profile);
    try {
      await saveCatalog();
    } catch (error) {
      profiles.pop();
      throw error;
    }
    return profile;
  });
  registerHandler('facebook:connect', async (event) => {
    trusted(event);
    return connectFacebook();
  });
  registerHandler('profiles:rename', async (event, id, name) => {
    trusted(event);
    const profile = profiles.find((p) => p.id === profileId(id));
    if (!profile) throw new Error('Perfil não encontrado.');
    const before = profile.name;
    profile.name = profileName(name);
    try {
      await saveCatalog();
    } catch (error) {
      profile.name = before;
      throw error;
    }
    if (active === id) send({ source: profile.name });
    notify('inbox:state', inboxState());
    return profile;
  });
  registerHandler('profiles:dialog', (event, visible) => {
    trusted(event);
    profileDialogOpen = visible === true;
    if (!webMode && displayedView) displayedView.setVisible(!profileDialogOpen);
    if (!profileDialogOpen && displayedView) resize();
  });
  registerHandler('profiles:remove', async (event, id) => {
    trusted(event);
    profileId(id);
    const index = profiles.findIndex((p) => p.id === id);
    if (index < 0) throw new Error('Perfil não encontrado.');
    if (listingService.batchActive() || foregroundId || scanning)
      throw new Error(
        'Aguarde a publicação, abertura ou atualização das contas terminar antes de remover.',
      );
    await win.webContents.executeJavaScript('window.multiListings?.save()');
    await flushAll(true);
    const [profile] = profiles.splice(index, 1);
    const removed = { ...profile, removedAt: new Date().toISOString() };
    removedProfiles.push(removed);
    try {
      await saveCatalog();
      await listingService.removeProfile(id);
    } catch (error) {
      removedProfiles.splice(removedProfiles.indexOf(removed), 1);
      profiles.splice(index, 0, profile);
      await saveCatalog();
      throw error;
    }
    const view = views.get(id);
    chatViews.delete(id);
    views.delete(id);
    touched.delete(id);
    scanQueue = scanQueue.filter((item) => item.id !== id);
    inbox.accounts.delete(id);
    for (const [popup, owner] of popups) if (owner === id) popup.close();
    if (displayedView === view) display(null);
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    const ses = sessions.get(id);
    sessions.delete(id);
    let cleanupFailed = false;
    try {
      if (ses) await ses.clearStorageData();
      await fs.rm(path.join(root, `session-${id}.enc`), { force: true });
    } catch {
      cleanupFailed = true;
    }
    dirtySessions.delete(id);
    cookieDigests.delete(id);
    if (active === id) await showUnifiedInbox();
    publishInbox();
    return { removed: true, cleanupFailed };
  });
  registerHandler('profiles:open', async (event, id) => {
    trusted(event);
    await open(id);
    return { ok: true };
  });
  registerHandler('inbox:state', (event) => {
    trusted(event);
    return inboxState();
  });
  registerHandler('inbox:show', async (event) => {
    trusted(event);
    return showUnifiedInbox();
  });
  registerHandler('inbox:refresh', (event) => {
    trusted(event);
    return refreshInbox();
  });
  registerHandler('inbox:open', async (event, key) => {
    trusted(event);
    return openConversation(key);
  });
  registerHandler('browser:budget', async (event, value) => {
    trusted(event);
    if (value !== undefined) {
      const before = maxPages;
      maxPages = pageLimit(value);
      try {
        while (views.size > maxPages) {
          const protectedIds = new Set(
            [...views].filter(([, v]) => v === displayedView).map(([key]) => key),
          );
          for (const owner of popups.values()) protectedIds.add(owner);
          for (const owner of views.keys())
            if (listingService?.ownsPage(owner)) protectedIds.add(owner);
          const victim = leastRecent([...views.keys()], touched, protectedIds);
          if (!victim) throw new Error('Conclua as janelas de login antes de reduzir o limite.');
          await releasePage(victim);
        }
        await atomic(path.join(root, 'settings.json'), JSON.stringify({ maxPages, economy }));
      } catch (error) {
        maxPages = before;
        throw error;
      }
    }
    publishInbox();
    return { limit: maxPages, activePages: views.size };
  });
  registerHandler('browser:economy', async (event, value) => {
    trusted(event);
    if (typeof value !== 'boolean') throw new Error('Modo de economia inválido.');
    await atomic(path.join(root, 'settings.json'), JSON.stringify({ maxPages, economy: value }));
    economy = value;
    await Promise.all([...views.values()].map(updateVisuals));
    publishInbox();
    return { economy };
  });
  registerHandler('profiles:close', async (event) => {
    trusted(event);
    if (!active) return { ok: true };
    const id = active;
    if (listingService?.isWorker(id))
      throw new Error('Esta conta está publicando. Aguarde a conclusão.');
    await saveCookies(id, sessions.get(id));
    for (const [popup, owner] of popups) if (owner === id) popup.close();
    const view = views.get(id);
    const chat = chatViews.get(id);
    if (displayedView === view || displayedView === chat?.view) display(null);
    views.delete(id);
    if (chat) {
      chatViews.delete(id);
      inbox.update(id, { status: 'CLOSED' });
      publishInbox();
    }
    for (const page of new Set([view, chat?.view].filter(Boolean))) page.webContents.close();
    active = null;
    send({
      location: 'Nenhum perfil aberto',
      back: false,
      forward: false,
      message: 'Perfil fechado. Sessão salva neste navegador.',
    });
    return { ok: true };
  });
  registerHandler('browser:navigate', async (event, action) => {
    trusted(event);
    if (listingService?.isWorker(active))
      throw new Error('Esta conta está publicando. Aguarde a conclusão.');
    if (
      profiles.find((p) => p.id === active)?.provider === 'facebook' &&
      ['chat', 'home'].includes(action)
    ) {
      const view = action === 'chat' ? await ensureChat(active, true) : await acquirePage(active);
      display(view);
      if (action === 'home') {
        chatViews.delete(active);
        await view.webContents.loadURL('https://www.facebook.com/marketplace/');
      }
      return { ok: true };
    }
    if (action === 'chat') {
      if (!active) throw new Error('Selecione um perfil.');
      const view = await ensureChat(active, true);
      display(view);
      return { ok: true };
    }
    const contents = displayedView?.webContents;
    if (!contents) throw new Error('Selecione um perfil.');
    if (action === 'home' || action === 'chat') {
      chatViews.delete(active);
      inbox.update(active, { status: 'PAUSED' });
      publishInbox();
      await contents.loadURL(
        action === 'home' ? 'https://www.olx.com.br/' : 'https://chat.olx.com.br/',
      );
    } else if (action === 'reload') {
      const entry = chatViews.get(active);
      if (entry) {
        entry.stopped = false;
        entry.openDeadline = 0;
        void contents.loadURL('https://chat.olx.com.br/').catch(() => {});
      } else contents.reload();
    } else if (action === 'back' && contents.navigationHistory.canGoBack())
      contents.navigationHistory.goBack();
    else if (action === 'forward' && contents.navigationHistory.canGoForward())
      contents.navigationHistory.goForward();
    else if (!['back', 'forward'].includes(action)) throw new Error('Comando inválido.');
    return { ok: true };
  });
  await win.loadURL(localOrigin + '/index.html');
  if (!selfTest) win.show();
  if (webMode) {
    remoteBrowser = require('./remote-browser.cjs').createRemoteBrowser({
      window: () => win,
      view: () => displayedView,
      popups,
      owner: () => active,
      conversation: () => (mode === 'unified' && displayedView ? remoteConversation : null),
      busy: (id) => listingService.isWorker(id),
    });
    webAccess = await require('./web-server.cjs').createWebServer({
      config: webConfiguration,
      invoke: async (channel, args) => {
        const handler = remoteHandlers.get(channel);
        if (!handler) throw Error('Operação indisponível.');
        return handler(
          { sender: win.webContents, senderFrame: win.webContents.mainFrame },
          ...args,
        );
      },
      snapshot: () => ({
        mode,
        profileId: active || null,
        source: profiles.find((p) => p.id === active)?.name || '',
        hasView: !!displayedView,
        conversationKey: mode === 'unified' && displayedView ? remoteConversation?.key : null,
        location: displayedView
          ? publicLocation(displayedView.webContents.getURL())
          : mode === 'listings'
            ? 'Anúncios'
            : mode === 'unified'
              ? 'Chats unificados'
              : 'Nenhum perfil aberto',
      }),
      batch: () => listingService.batchState(),
      photos: async (files) => {
        if (listingService.batchActive())
          throw Error('Aguarde a publicação antes de importar fotos.');
        const temporary = await fs.mkdtemp(path.join(root, 'upload-'));
        try {
          const sources = [];
          for (const file of files) {
            const source = path.join(temporary, randomUUID() + path.extname(file.name).slice(0, 8));
            await fs.writeFile(source, Buffer.from(file.data, 'base64'), { mode: 0o600 });
            sources.push(source);
          }
          return await listingService.importPhotos(sources);
        } finally {
          for (const name of await fs.readdir(temporary)) await fs.rm(path.join(temporary, name));
          await fs.rmdir(temporary);
        }
      },
      frame: () => remoteBrowser.frame(),
      input: (command) => remoteBrowser.input(command),
    });
    console.log('MULTIOLX_WEB_READY port=' + webAccess.port);
    const shutdown = () => app.quit();
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
  saveTimer = setInterval(
    () =>
      void flushAll().catch(() =>
        send({
          message:
            'A sessão não pôde ser salva no cofre. Mantenha o navegador aberto e confira o armazenamento.',
          error: true,
        }),
      ),
    30000,
  );
  inboxTimer = setInterval(() => {
    for (const [id, entry] of chatViews) {
      const interval = entry.view === displayedView ? 5000 : 15000;
      if (Date.now() - (entry.lastRead || 0) >= interval) void readInbox(id);
    }
    if (!scanning && profiles.length && Date.now() - lastScan >= 30000) {
      lastScan = Date.now();
      const profile = profiles[scanCursor++ % profiles.length];
      const state = inbox.accounts.get(profile.id)?.status;
      if (
        !['BLOCKED', 'AUTH_REQUIRED', 'LAYOUT_CHANGED', 'ERROR', 'TIMEOUT', 'CLOSED'].includes(
          state,
        )
      )
        queueScan([profile.id]);
    }
    const memoryMB = Math.round(
      app
        .getAppMetrics()
        .reduce((sum, p) => sum + (p.memory?.privateBytes || p.memory?.workingSetSize || 0), 0) /
        1024,
    );
    if (!win.isDestroyed())
      notify('browser:resources', {
        memoryMB,
        activePages: views.size,
        limit: maxPages,
      });
  }, 5000);
  if (process.argv.includes('--self-test')) {
    console.log('BROWSER_SMOKE: iniciar catálogo e sessões');
    // Local-only smoke test: no OLX/Google requests and no personal profiles.
    const a = await win.webContents.executeJavaScript("window.multiBrowser.create('Fixture A')");
    const b = await win.webContents.executeJavaScript("window.multiBrowser.create('Fixture B')");
    await win.webContents.executeJavaScript(
      `window.multiBrowser.rename('${a.id}', 'Fixture A renomeada')`,
    );
    const catalog = await win.webContents.executeJavaScript('window.multiBrowser.list()');
    if (catalog.length !== 2 || catalog[0].name !== 'Fixture A renomeada')
      throw new Error('Ponte local ou catálogo falhou.');
    const sa = await openSession(a.id),
      sb = await openSession(b.id);
    await sa.cookies.set({
      url: 'https://fixture.test/',
      name: 'session',
      value: 'local-fixture-only',
    });
    if ((await sb.cookies.get({ url: 'https://fixture.test/' })).length)
      throw new Error('Sessões não isoladas.');
    await saveCookies(a.id, sa);
    const decoded = JSON.parse(
      safeStorage.decryptString(await fs.readFile(path.join(root, `session-${a.id}.enc`))),
    );
    if (!decoded.some((c) => c.value === 'local-fixture-only'))
      throw new Error('Snapshot não persistiu.');
    const restore = session.fromPartition('persist:restore-fixture');
    await restore.cookies.set(cookieForRestore(decoded[0]));
    if (
      (await restore.cookies.get({ url: 'https://fixture.test/' }))[0]?.value !==
      'local-fixture-only'
    )
      throw new Error('Restauração falhou.');
    if (!secureStorage()) throw new Error('Cofre indisponível.');
    if (process.env.MULTIOLX_BROWSER_SCREENSHOT) {
      console.log('BROWSER_SMOKE: capturar interface inicial');
      win.showInactive();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await fs.writeFile(
        process.env.MULTIOLX_BROWSER_SCREENSHOT,
        (
          await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
        ).toPNG(),
      );
    }
    let fixtureRequests = 0;
    console.log('BROWSER_SMOKE: navegar fixture individual');
    sa.protocol.handle('https', () => {
      fixtureRequests++;
      return new Response('<title>Fixture local MultiOLX</title><h1>Somente teste local</h1>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    });
    await win.webContents.executeJavaScript(`window.multiBrowser.open('${a.id}')`);
    if (
      (await views.get(a.id).webContents.getTitle()) !== 'Fixture local MultiOLX' ||
      fixtureRequests !== 1
    )
      throw new Error('A navegação isolada não carregou a fixture.');
    console.log('BROWSER_SMOKE: renomear com página nativa aberta');
    send({ profileId: a.id, mode: 'individual' });
    await win.webContents.executeJavaScript(`(async () => {
      await render();
      document.getElementById('rename').click();
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (
      displayedView.getVisible() ||
      !(await win.webContents.executeJavaScript("document.getElementById('renameDialog').open"))
    )
      throw new Error('A página nativa encobriu o formulário de renomear.');
    await win.webContents.executeJavaScript(`document.getElementById('cancelRename').click()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!displayedView.getVisible()) throw new Error('Cancelar não restaurou a página.');
    await win.webContents.executeJavaScript(`document.getElementById('rename').click()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await win.webContents.executeJavaScript(`
      document.getElementById('renameName').value = 'Fixture A atualizada';
      document.getElementById('renameForm').requestSubmit();
    `);
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (
      !displayedView.getVisible() ||
      profiles.find((p) => p.id === a.id).name !== 'Fixture A atualizada'
    )
      throw new Error('Salvar nome não restaurou a página ou o catálogo.');
    await win.webContents.executeJavaScript(
      `window.multiBrowser.rename('${a.id}', 'Fixture A renomeada')`,
    );
    await win.webContents.executeJavaScript('window.multiBrowser.close()');
    if (views.size !== 0) throw new Error('O perfil não foi fechado.');
    sa.protocol.unhandle('https');
    console.log('BROWSER_SMOKE: testar inbox unificado');
    const fixtureChat = (label) =>
      `<title>Chat fixture local</title><a data-testid="chat-list-item" id="same" href="?chat-id=same"><div class="w-[8px] h-[8px] bg-primary-100" style="width:8px;height:8px;visibility:${label === 'A' ? 'visible' : 'hidden'}"></div><span class="typo-caption">Produto ${label}</span><div class="text-2">Contato ${label}</div><div class="text-1-5">Mensagem ${label}</div><div class="text-1-5">12:00</div><span class="avatar">4</span><img src="https://chat.olx.com.br/fixture-image.png"></a><div id="messages"></div><script>if(localStorage.getItem('fixture-read'))document.querySelector('[class~="w-[8px]"]').style.visibility='hidden';document.querySelector('a').onclick=e=>{e.preventDefault();localStorage.setItem('fixture-read','1');history.pushState(null,'',e.currentTarget.getAttribute('href'));document.querySelector('[class~="w-[8px]"]').style.visibility='hidden';document.querySelector('#messages').innerHTML='<div class="peer/bubble ${label === 'A' ? 'self-start items-start' : 'self-end items-end'}"><span class="whitespace-pre-wrap">Mensagem ${label}</span></div><textarea placeholder="Mensagem de teste local"></textarea>';};</script>`;
    const chatRequests = { A: 0, B: 0 };
    const imageRequests = { A: 0, B: 0 };
    const imageResponse = () =>
      new Response(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
        { headers: { 'Content-Type': 'image/png' } },
      );
    sa.protocol.handle('https', (request) => {
      if (new URL(request.url).pathname === '/fixture-image.png') {
        imageRequests.A++;
        return imageResponse();
      }
      chatRequests.A++;
      return new Response(fixtureChat('A'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    });
    sb.protocol.handle('https', (request) => {
      if (new URL(request.url).pathname === '/fixture-image.png') {
        imageRequests.B++;
        return imageResponse();
      }
      chatRequests.B++;
      return new Response(fixtureChat('B'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    });
    await win.webContents.executeJavaScript('window.multiBrowser.unified()');
    await win.webContents.executeJavaScript('window.multiBrowser.refreshInbox()');
    for (let i = 0; i < 20 && inboxState().conversations.length !== 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      for (const id of [a.id, b.id]) await readInbox(id);
    }
    const combined = inboxState();
    console.log(
      'BROWSER_SMOKE_INBOX ' +
        JSON.stringify(
          combined.accounts.map((a) => ({ name: a.name, status: a.status, count: a.count })),
        ),
    );
    if (
      combined.conversations.length !== 2 ||
      new Set(combined.conversations.map((c) => c.key)).size !== 2
    )
      throw new Error('A unificação misturou ou perdeu conversas de contas diferentes.');
    if (
      combined.conversations.find((c) => c.profileId === a.id).attention !== 'unread' ||
      combined.conversations.some((c) => c.unreadCount !== null)
    )
      throw new Error(
        'O ponto nativo ou a ausência de contagem foram interpretados incorretamente.',
      );
    if (imageRequests.A || imageRequests.B)
      throw new Error('Imagens foram baixadas no chat de fundo.');
    if (
      !(await win.webContents.executeJavaScript(`(() => {
      const popover=document.getElementById('inboxFilters');
      if (popover.matches(':popover-open') || document.getElementById('inboxFilter').getClientRects().length) return false;
      document.getElementById('filterToggle').click();
      const opened=popover.matches(':popover-open') && document.getElementById('inboxFilter').getClientRects().length > 0;
      popover.hidePopover();
      return opened && !document.querySelector('.attention-hint') && document.querySelectorAll('.unread-dot').length === 1 && !document.querySelector('.unread-dot').textContent;
    })()`))
    )
      throw new Error('O botão de filtro ou o indicador compacto falhou.');
    const pageA = chatViews.get(a.id).view;
    await pageA.webContents.executeJavaScript(
      "document.body.insertAdjacentHTML('beforeend','<div data-testid=advertising-placeholder>Publicidade fictícia</div>')",
    );
    await updateVisuals(pageA);
    if (
      (await pageA.webContents.executeJavaScript(
        "getComputedStyle(document.querySelector('[data-testid=advertising-placeholder]')).contentVisibility",
      )) !== 'hidden'
    )
      throw new Error('Publicidade de fundo continuou renderizando.');
    await win.webContents.executeJavaScript(
      "document.getElementById('attentionFilter').value='unread';document.getElementById('attentionFilter').dispatchEvent(new Event('change'))",
    );
    if (
      (await win.webContents.executeJavaScript(
        "document.querySelectorAll('.conversation-row').length",
      )) !== 1
    )
      throw new Error('Filtro de não visualizadas falhou.');
    await win.webContents.executeJavaScript(
      "document.getElementById('attentionFilter').value='';document.getElementById('attentionFilter').dispatchEvent(new Event('change'))",
    );
    // Rendered UI list and filter, in the disposable local fixture only.
    await win.webContents.executeJavaScript(
      "document.getElementById('inboxSearch').value='Contato A';document.getElementById('inboxSearch').dispatchEvent(new Event('input'))",
    );
    if (
      (await win.webContents.executeJavaScript(
        "document.querySelectorAll('.conversation-row').length",
      )) !== 1
    )
      throw new Error('Busca unificada falhou.');
    await win.webContents.executeJavaScript(
      "document.getElementById('inboxSearch').value='';document.getElementById('inboxSearch').dispatchEvent(new Event('input'))",
    );
    await win.webContents.executeJavaScript(
      `document.getElementById('inboxFilter').value='${b.id}';document.getElementById('inboxFilter').dispatchEvent(new Event('change'))`,
    );
    if (
      await win.webContents.executeJavaScript(
        "document.querySelectorAll('.conversation-row').length!==1||!document.querySelector('.conversation-row').textContent.includes('Contato B')",
      )
    )
      throw new Error('Filtro por conta falhou.');
    await win.webContents.executeJavaScript(
      "document.getElementById('inboxFilter').value='';document.getElementById('inboxFilter').dispatchEvent(new Event('change'))",
    );
    if (process.env.MULTIOLX_BROWSER_SCREENSHOT)
      await fs.writeFile(
        path.resolve('artifacts/browser-unified-fixture.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
    const beforeClicks = JSON.stringify(chatRequests);
    for (const owner of [a.id, b.id]) {
      const conversation = combined.conversations.find((c) => c.profileId === owner);
      await win.webContents.executeJavaScript(
        `window.multiBrowser.openConversation(${JSON.stringify(conversation.key)})`,
      );
      if (
        active !== owner ||
        displayedView.webContents.session !== sessions.get(owner) ||
        mode !== 'unified'
      )
        throw new Error('A conversa abriu na conta errada.');
      await readInbox(owner);
      await updateVisuals(displayedView);
      if (
        owner === a.id &&
        (await displayedView.webContents.executeJavaScript(
          "getComputedStyle(document.querySelector('[data-testid=advertising-placeholder]')).contentVisibility",
        )) === 'hidden'
      )
        throw new Error('O conteúdo visual não voltou ao exibir a conta.');
      for (let attempt = 0; attempt < 20; attempt++) {
        if (
          await displayedView.webContents.executeJavaScript('document.images[0].naturalWidth > 0')
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (
        !(await displayedView.webContents.executeJavaScript('document.images[0].naturalWidth > 0'))
      )
        throw new Error('A imagem adiada não carregou ao exibir a conta.');
      const expected = owner === a.id ? 'awaiting' : 'outgoing';
      if (inbox.find(conversation.key, profiles).attention !== expected)
        throw new Error('O detalhe não confirmou o estado de atendimento correto: ' + expected);
    }
    for (const attention of ['awaiting', 'outgoing']) {
      await win.webContents.executeJavaScript(
        `document.getElementById('attentionFilter').value='${attention}';document.getElementById('attentionFilter').dispatchEvent(new Event('change'))`,
      );
      if (
        (await win.webContents.executeJavaScript(
          "document.querySelectorAll('.conversation-row').length",
        )) !== 1
      )
        throw new Error('Filtro de atendimento falhou: ' + attention);
    }
    await win.webContents.executeJavaScript(
      "document.getElementById('attentionFilter').value='';document.getElementById('attentionFilter').dispatchEvent(new Event('change'))",
    );
    console.log(
      'MULTIOLX_ATTENTION_ECONOMY_OK: filtros, autoria, ponto não lido, imagens adiadas em fundo e restauradas ao abrir.',
    );
    const scrollPage = displayedView.webContents;
    await scrollPage.executeJavaScript(`(() => {
      const messages = document.getElementById('messages');
      messages.style.cssText='height:60px;overflow-y:auto;display:flex;flex-direction:column-reverse';
      for (const child of messages.children) child.style.flex='0 0 300px';
      messages.scrollTop=0;
    })()`);
    if (!(await scrollPage.executeJavaScript(`(${readChatDocument.toString()})()`)).detail)
      throw new Error('A leitura perdeu o histórico recente com rolagem reversa.');
    await scrollPage.executeJavaScript("document.getElementById('messages').scrollTop=-100");
    if ((await scrollPage.executeJavaScript(`(${readChatDocument.toString()})()`)).detail)
      throw new Error('O histórico antigo foi associado à última mensagem.');
    await scrollPage.executeJavaScript(
      "document.getElementById('messages').removeAttribute('style');for(const child of document.getElementById('messages').children) child.removeAttribute('style')",
    );
    const beforeCounts = JSON.parse(beforeClicks);
    if (chatRequests.A !== beforeCounts.A + 1 || chatRequests.B !== beforeCounts.B)
      throw new Error('A troca de conta não fechou apenas a conversa anterior.');
    const hiddenA = chatViews.get(a.id).view.webContents;
    await chatViews.get(a.id).returning;
    if (
      await hiddenA.executeJavaScript(
        "Boolean(document.querySelector('textarea')) || location.search.includes('chat-id')",
      )
    )
      throw new Error('A conversa anterior continuou aberta em segundo plano.');
    const escapePage = displayedView.webContents;
    // A local composer clears, blurs and replaces its DOM node after Enter,
    // reproducing the site's loss of typing focus without sending real messages.
    win.show();
    win.focus();
    escapePage.focus();
    await escapePage.executeJavaScript(`(() => {
      document.body.dataset.focusSends='0';
      document.addEventListener('keydown', event => {
        if (event.target.tagName !== 'TEXTAREA' || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
        event.preventDefault();
        document.body.dataset.focusSends=String(Number(document.body.dataset.focusSends)+1);
        document.body.dataset.lastSent=event.target.value;
        const old=event.target;old.value='';old.blur();
        setTimeout(()=>old.replaceWith(old.cloneNode(false)),20);
      });
      document.querySelector('textarea').focus();
    })()`);
    for (const message of ['Primeira mensagem local', 'Segunda mensagem local']) {
      escapePage.insertText(message);
      escapePage.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      escapePage.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      let focused = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        focused = await escapePage.executeJavaScript(
          `document.activeElement === document.querySelector('textarea') && document.body.dataset.lastSent === ${JSON.stringify(message)}`,
        );
        if (focused) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!focused)
        throw new Error('Enter perdeu o foco após limpar/substituir o campo de mensagem.');
    }
    if ((await escapePage.executeJavaScript('document.body.dataset.focusSends')) !== '2')
      throw new Error('A preservação de foco repetiu um envio.');
    await escapePage.executeJavaScript(`(() => {
      const button=document.createElement('button');button.id='focus-elsewhere';button.textContent='Outro controle';document.body.append(button);
      const input=document.querySelector('textarea');input.value='Terceira mensagem local';
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));button.focus();
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (!(await escapePage.executeJavaScript("document.activeElement.id === 'focus-elsewhere'")))
      throw new Error('A restauração de foco interferiu numa troca manual de campo.');
    console.log(
      'MULTIOLX_COMPOSER_FOCUS_OK: dois envios consecutivos com Enter, campo substituído e clique manual respeitado.',
    );
    escapePage.focus();
    escapePage.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    escapePage.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!displayedView && !chatViews.get(b.id).returning) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (
      displayedView ||
      active ||
      mode !== 'unified' ||
      (await escapePage.executeJavaScript(
        "Boolean(document.querySelector('textarea')) || location.search.includes('chat-id')",
      ))
    )
      throw new Error('Esc não voltou à lista ou deixou a conversa ativa.');
    // Simulate delivery while the account stays on its list, not in a conversation.
    await escapePage.executeJavaScript(`(() => {
      const open = !!document.querySelector('textarea');
      document.querySelector('[class~="w-[8px]"]').style.visibility = open ? 'hidden' : 'visible';
      document.querySelector('.text-1-5').textContent = 'Nova mensagem recebida';
    })()`);
    await readInbox(b.id);
    if (inboxState().conversations.find((c) => c.profileId === b.id)?.attention !== 'unread')
      throw new Error('A mensagem recebida após Esc foi marcada como visualizada.');
    await openConversation(combined.conversations.find((c) => c.profileId === b.id).key);
    await win.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}))`,
    );
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!displayedView && !chatViews.get(b.id).returning) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (displayedView) throw new Error('Esc no painel não fechou a conversa.');
    await openConversation(combined.conversations.find((c) => c.profileId === b.id).key);
    console.log(
      'MULTIOLX_ESCAPE_UNREAD_OK: Esc na OLX e no painel fecha o detalhe; novas mensagens na lista permanecem não lidas.',
    );
    await chatViews
      .get(b.id)
      .view.webContents.executeJavaScript("document.querySelector('a').remove()");
    await readInbox(b.id);
    if (
      inbox.accounts.get(b.id).status !== 'DETAIL' ||
      inboxState().conversations.find((c) => c.profileId === b.id).stale
    )
      throw new Error('A visualização da conversa foi confundida com falha de conexão.');
    await win.webContents.executeJavaScript(`window.multiBrowser.open('${a.id}')`);
    await win.webContents.executeJavaScript("window.multiBrowser.navigate('chat')");
    if (displayedView !== chatViews.get(a.id).view || mode !== 'individual')
      throw new Error('O chat individual não compartilha a sessão e a página corretas.');
    await win.webContents.executeJavaScript('window.multiBrowser.unified()');
    if (
      hasOpenConversation(chatViews.get(a.id).view) ||
      hasOpenConversation(chatViews.get(b.id).view)
    )
      throw new Error('Voltar pelo botão deixou uma conversa aberta em segundo plano.');
    await chatViews
      .get(a.id)
      .view.webContents.executeJavaScript(
        "document.title='Attention Required! | Cloudflare';document.body.innerHTML='<h1>Sorry, you have been blocked</h1>'",
      );
    await readInbox(a.id);
    if (
      inboxState().accounts[0].status !== 'BLOCKED' ||
      !inboxState().conversations.find((c) => c.profileId === a.id)?.stale
    )
      throw new Error('O bloqueio apagou a última leitura.');
    await chatViews
      .get(b.id)
      .view.webContents.executeJavaScript(
        "document.body.textContent='Você ainda não possui conversa ativa'",
      );
    await readInbox(b.id);
    if (
      inboxState().conversations.some((c) => c.profileId === b.id) ||
      inboxState().conversations.length !== 1
    )
      throw new Error('A caixa vazia alterou outra conta.');
    const preserved = inboxState().conversations.length;
    for (let i = 0; i < 6; i++) {
      const p = await win.webContents.executeJavaScript(
        `window.multiBrowser.create('Conta simulada ${i + 1}')`,
      );
      const ses = await openSession(p.id);
      ses.protocol.handle(
        'https',
        () =>
          new Response(fixtureChat(`S${i}`), {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
      );
      await waitForList(p.id);
      if (views.size > 2) throw new Error('O limite de páginas ativas foi excedido.');
    }
    if (inboxState().conversations.length !== preserved + 6)
      throw new Error('A suspensão perdeu os resumos das contas.');
    if (inboxState().conversations.some((c) => c.paused && c.stale))
      throw new Error('Uma conta em espera foi mostrada como falha.');
    console.log(
      'MULTIOLX_RESOURCE_TEST_OK: 8 perfis, no máximo 2 páginas, resumos preservados e seleção sem recarregar.',
    );
    const noticePage = chatViews.get(profiles.at(-1).id).view.webContents;
    await noticePage.executeJavaScript(
      `document.body.insertAdjacentHTML('beforeend','<div id="test-tour" style="position:fixed;top:40px;left:120px;width:500px;height:400px"><button aria-label="Fechar" style="position:absolute;right:10px;top:10px" onclick="this.parentElement.remove()">×</button><h2>Evoluímos pra você negociar com facilidade e segurança</h2></div>')`,
    );
    if (!(await noticePage.executeJavaScript(`(${dismissAppPromotion.toString()})()`)))
      throw new Error('O aviso de novidades não foi dispensado.');
    if (await noticePage.executeJavaScript("Boolean(document.getElementById('test-tour'))"))
      throw new Error('O aviso de novidades continuou aberto.');
    await noticePage.executeJavaScript(
      `document.body.insertAdjacentHTML('beforeend','<div id="unrelated-dialog"><button aria-label="Fechar" onclick="this.parentElement.remove()">×</button><h2>Confirmar outra operação</h2></div>')`,
    );
    if (await noticePage.executeJavaScript(`(${dismissAppPromotion.toString()})()`))
      throw new Error('Uma janela não relacionada foi dispensada.');
    console.log(
      'MULTIOLX_BROWSER_SELF_TEST_OK: UI, IPC, catálogo, navegação, cofre, isolamento, inbox unificado, busca, conta de origem, bloqueio e caixa vazia.',
    );
    console.log('BROWSER_LISTINGS: base, variações, fotos e formulário local');
    const photoFile = path.join(root, 'test-photo.png');
    await fs.writeFile(
      photoFile,
      nativeImage
        .createFromBitmap(Buffer.alloc(100 * 100 * 4, 255), { width: 100, height: 100 })
        .toPNG(),
    );
    const originalDialog = dialog.showOpenDialog;
    const secondPhotoFile = path.join(root, 'test-photo-second.png');
    await fs.writeFile(
      secondPhotoFile,
      nativeImage
        .createFromBitmap(Buffer.alloc(100 * 100 * 4, 128), { width: 100, height: 100 })
        .toPNG(),
    );
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [photoFile, secondPhotoFile],
    });
    let assets;
    try {
      assets = await win.webContents.executeJavaScript('window.multiBrowser.pickListingPhotos()');
    } finally {
      dialog.showOpenDialog = originalDialog;
    }
    let listing = await win.webContents.executeJavaScript('window.multiBrowser.createListing()');
    listing.base = {
      title: 'Produto local de teste',
      description: 'Descrição base local',
      price: '100',
      postalCode: '90000-000',
      category: 'Celulares',
    };
    listing.targets = [a.id, b.id];
    listing.photos = assets.map((p) => p.id);
    listing.overrides = { [b.id]: { description: 'Descrição exclusiva B', price: '90' } };
    listing = await win.webContents.executeJavaScript(
      `window.multiBrowser.saveListing(${JSON.stringify(listing)})`,
    );
    await win.webContents.executeJavaScript('window.multiListings.open()');
    await win.webContents.executeJavaScript(
      "document.getElementById('rotateListingCover').click()",
    );
    await win.webContents.executeJavaScript(
      "document.getElementById('listing-description').value='Descrição base atualizada';document.getElementById('listing-description').dispatchEvent(new Event('input'))",
    );
    await win.webContents.executeJavaScript('window.multiListings.save()');
    listing = listingService.catalog.find(listing.id);
    const firstPhotos = await listingService.photoPayload(listing.id, a.id);
    const secondPhotos = await listingService.photoPayload(listing.id, b.id);
    if (
      !listing.rotateCover ||
      firstPhotos.length !== 2 ||
      secondPhotos[0].data !== firstPhotos[1].data ||
      secondPhotos[1].data !== firstPhotos[0].data ||
      !(await win.webContents.executeJavaScript(
        "document.querySelectorAll('.listing-cover-preview').length === 2",
      ))
    )
      throw new Error('Alternância de capa não chegou às fotos enviadas ou à prévia.');
    console.log(
      'MULTIOLX_COVER_ROTATION_OK: opção salva, prévia por conta e fotos de envio na ordem correta.',
    );
    const reviewed = listingService.catalog.review(listing.id, profiles);
    if (
      reviewed[0].listing.description !== 'Descrição base atualizada' ||
      reviewed[1].listing.description !== 'Descrição exclusiva B' ||
      reviewed[1].listing.title !== reviewed[0].listing.title
    )
      throw new Error('O anúncio base não respeitou as variações por conta.');
    await win.webContents.executeJavaScript(
      "document.getElementById('reviewListingDetails').click()",
    );
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await win.webContents.executeJavaScript("document.getElementById('listingReview').open"))
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (
      (await win.webContents.executeJavaScript(
        "document.querySelectorAll('.listing-review-card').length",
      )) !== 2
    )
      throw new Error('Revisão não respeitou contas selecionadas.');
    await fs.writeFile(
      path.resolve('artifacts/browser-listings-fixture.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
    await win.webContents.executeJavaScript("document.getElementById('listingReview').close()");
    sa.protocol.unhandle('https');
    sa.protocol.handle(
      'https',
      () =>
        new Response(
          `<title>Publicação local</title><label for="subject">Título</label><input id="subject" name="subject" required><label for="body">Descrição</label><textarea id="body" name="body" required></textarea><input name="price" id="price" aria-label="Preço"><input name="zipcode" id="zipcode" aria-label="CEP"><input type="file" accept="image/*" multiple><button onclick="document.body.dataset.sent='true'">Enviar anúncio</button>`,
          { headers: { 'Content-Type': 'text/html;charset=utf-8' } },
        ),
    );
    const preparation = await win.webContents.executeJavaScript(
      `window.multiListings.prepare('${listing.id}','${a.id}')`,
    );
    if (!preparation.filled.includes('title') || !preparation.photos)
      throw new Error('O formulário local não recebeu texto e fotos.');
    const publisher = views.get(a.id).webContents;
    if (
      !(await publisher.executeJavaScript(
        "document.getElementById('body').value==='Descrição base atualizada' && document.querySelector('input[type=file]').files.length===2 && !document.body.dataset.sent",
      ))
    )
      throw new Error('Preparar publicou ou perdeu dados do anúncio.');
    await win.webContents.executeJavaScript(
      `window.multiBrowser.submitListing('${listing.id}','${a.id}',${listing.revision})`,
    );
    if (!(await publisher.executeJavaScript("document.body.dataset.sent==='true'")))
      throw new Error('O envio explícito não acionou o formulário local.');
    let duplicate = false;
    try {
      await win.webContents.executeJavaScript(
        `window.multiBrowser.submitListing('${listing.id}','${a.id}',${listing.revision})`,
      );
    } catch {
      duplicate = true;
    }
    if (!duplicate) throw new Error('O envio incerto permitiu repetição automática.');
    sb.protocol.unhandle('https');
    sb.protocol.handle(
      'https',
      () =>
        new Response(
          `<title>Etapas locais</title><div id="step"><input id="subject" aria-label="Título"><button onclick="photos()">Continuar</button></div><script>
      function photos(){document.getElementById('step').innerHTML='<input type="file" accept="image/*" multiple><button onclick="details()">Continuar</button>';}
      function details(){document.getElementById('step').innerHTML='<textarea id="body" aria-label="Descrição"></textarea><input id="price" aria-label="Preço"><input id="zipcode" aria-label="CEP"><button onclick="document.body.dataset.sent=1">Enviar anúncio</button>';}
      </script>`,
          { headers: { 'Content-Type': 'text/html;charset=utf-8' } },
        ),
    );
    const steps = await win.webContents.executeJavaScript(
      `window.multiBrowser.prepareListing('${listing.id}','${b.id}',${listing.revision})`,
    );
    if (
      !steps.photos ||
      !['title', 'description', 'price', 'postalCode'].every((key) => steps.filled.includes(key))
    )
      throw new Error('O preenchimento em etapas não reaproveitou todos os dados.');
    if (
      !(await views
        .get(b.id)
        .webContents.executeJavaScript(
          "document.getElementById('body').value==='Descrição exclusiva B' && document.getElementById('price').value==='90' && !document.body.dataset.sent",
        ))
    )
      throw new Error(
        'A variação B não foi aplicada ao formulário em etapas ou houve envio automático.',
      );
    await win.webContents.executeJavaScript('window.multiBrowser.listings()');
    queueScan([b.id]);
    for (let attempt = 0; attempt < 30 && scanning; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    await acquirePage(profiles[2].id);
    if (
      !views.has(b.id) ||
      !views.get(b.id).webContents.getURL().startsWith('https://www2.olx.com.br/desapega')
    )
      throw new Error('O rodízio de chats substituiu um formulário em preparo.');
    // Regression for the actual wizard: hidden extension-based upload, asynchronous
    // processing, custom comboboxes, onboarding redirect, free offer and success dialog.
    await win.webContents.executeJavaScript(
      `window.multiBrowser.resolveListing('${listing.id}','${b.id}','not_sent')`,
    );
    const { listingWizardFixture } = require('../scripts/listing-wizard-fixture.cjs');
    sb.protocol.unhandle('https');
    sb.protocol.handle(
      'https',
      (request) =>
        new Response(listingWizardFixture(request.url), {
          headers: { 'Content-Type': 'text/html;charset=utf-8' },
        }),
    );
    const wizard = await win.webContents.executeJavaScript(
      `window.multiBrowser.prepareListing('${listing.id}','${b.id}',${listing.revision})`,
    );
    const wizardContents = views.get(b.id).webContents;
    if (wizard.canSubmit || wizardContents.getURL() !== 'https://olx-pay.olx.com.br/aderir')
      throw new Error('O fluxo não parou para os dados pessoais.');
    if (
      !(await wizardContents.executeJavaScript(
        "sessionStorage.length===0 && document.getElementById('name').value===''",
      ))
    )
      throw new Error('Dados pessoais preenchidos automaticamente.');
    await wizardContents.executeJavaScript("document.getElementById('manual').click()");
    await new Promise((resolve) => setTimeout(resolve, 350));
    const resumed = await win.webContents.executeJavaScript(
      `window.multiBrowser.fillListing('${listing.id}','${b.id}',${listing.revision})`,
    );
    if (
      !resumed.canSubmit ||
      !(await wizardContents.executeJavaScript(
        "document.querySelector('[aria-label=NO_PRODUCT]').checked && !document.querySelector('[aria-label=PACKAGE_GOLD]').checked",
      ))
    )
      throw new Error('A retomada não selecionou a publicação gratuita.');
    const sent = await win.webContents.executeJavaScript(
      `window.multiBrowser.submitListing('${listing.id}','${b.id}',${listing.revision})`,
    );
    if (
      sent.uncertain ||
      listingService.catalog.find(listing.id).deliveries[b.id].state !== 'SUBMITTED'
    )
      throw new Error('A confirmação de envio não foi reconhecida.');
    let blockedRepeat = false;
    try {
      await win.webContents.executeJavaScript(
        `window.multiBrowser.submitListing('${listing.id}','${b.id}',${listing.revision})`,
      );
    } catch {
      blockedRepeat = true;
    }
    if (!blockedRepeat) throw new Error('Envio confirmado permitiu repetição.');
    // Verify by exact title/price/public URL, never by a global success word alone.
    sb.protocol.unhandle('https');
    sb.protocol.handle(
      'https',
      () =>
        new Response(
          `<section><div>PUBLICADO</div><article><a href="https://www.olx.com.br/vi/1234567890">Produto local de teste</a><span>R$ 90,00</span></article><div>PUBLICADO</div><article><a href="https://www.olx.com.br/vi/1234567891">Outro produto</a><span>R$ 900,00</span></article></section>`,
          { headers: { 'Content-Type': 'text/html;charset=utf-8' } },
        ),
    );
    await wizardContents.loadURL('https://conta.olx.com.br/anuncios/publicados');
    await listingService.verifyPublished(listing.id, b.id, wizardContents);
    if (listingService.catalog.find(listing.id).deliveries[b.id].state !== 'PUBLISHED')
      throw new Error('Publicado não foi conciliado.');
    sb.protocol.unhandle('https');
    sb.protocol.handle(
      'https',
      () =>
        new Response(
          `<label for="cosmetic_type">Tipo</label><div id="cosmetic_type" role="combobox" tabindex="0" aria-controls="menu" onpointerdown="openOptions('cosmetic_type')">Produtos para pele</div><label for="cosmetic_brand">Marca</label><div id="cosmetic_brand" role="combobox" tabindex="0" aria-controls="menu" onpointerdown="openOptions('cosmetic_brand')">Selecione</div><div id="menu"></div><div aria-hidden="true"><span role="option">Outros</span><span role="option">Lattafa</span></div><script>function openOptions(id){const options=id==='cosmetic_type'?['Produtos para pele','Outros']:document.getElementById('cosmetic_type').innerText==='Outros'?['Lattafa','Outras marcas']:['Marca para pele'];const menu=document.getElementById('menu');menu.replaceChildren(...options.map(text=>{const li=document.createElement('li');li.setAttribute('role','option');li.innerText=text;li.onpointerup=()=>{document.getElementById(id).innerText=text;menu.replaceChildren();};return li;}));}document.addEventListener('keydown',e=>{if(e.key==='Escape')document.getElementById('menu').replaceChildren();});</script>`,
          { headers: { 'Content-Type': 'text/html;charset=utf-8' } },
        ),
    );
    await wizardContents.loadURL('https://www2.olx.com.br/desapega');
    const { attributeDocument, fillAttributes } = require('./listing-attributes.cjs');
    display(null); // Native selectors must also work without a focused/visible account.
    const assisted = await fillAttributes(
      { title: 'Perfume' },
      {
        assertActive: () => {},
        pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        dom: (command) =>
          wizardContents.executeJavaScript(
            `(${attributeDocument.toString()})(${JSON.stringify(command)})`,
          ),
        choose: async (_product, field) => ({
          option: field.id === 'cosmetic_type' ? 'Outros' : 'Lattafa',
          compatible: true,
        }),
      },
    );
    if (assisted.pending.length || !assisted.compatible || assisted.changes.length !== 2)
      throw new Error('As características por IA não foram aplicadas às opções públicas.');
    sb.protocol.unhandle('https');
    const { attributePortalFixture } = require('../scripts/listing-attribute-portal-fixture.cjs');
    sb.protocol.handle(
      'https',
      () =>
        new Response(attributePortalFixture(), {
          headers: { 'Content-Type': 'text/html;charset=utf-8' },
        }),
    );
    await wizardContents.loadURL('https://www2.olx.com.br/desapega');
    const portalResult = await fillAttributes(
      { condition: 'Novo' },
      {
        assertActive: () => {},
        pause: (ms) => new Promise((r) => setTimeout(r, ms)),
        dom: (command) =>
          wizardContents.executeJavaScript(
            `(${attributeDocument.toString()})(${JSON.stringify(command)})`,
          ),
        choose: async (_product, field) => ({
          option: field.id.endsWith('_type')
            ? 'Boombox'
            : field.id.endsWith('_brand')
              ? 'Outros'
              : 'Novo',
          compatible: true,
        }),
      },
    );
    if (portalResult.pending.length || portalResult.changes.length !== 3)
      throw Error(
        'Seletores com portal e cópias ocultas falharam: ' + JSON.stringify(portalResult),
      );
    console.log(
      'MULTIOLX_LISTING_AI_OK: opções dependentes, seleção pública e conferência de valores com IA simulada.',
    );
    sb.protocol.unhandle('https');
    sb.protocol.handle(
      'https',
      () =>
        new Response(
          `<h1>Selecione uma categoria para anunciar</h1><div class="card" tabindex="0" onpointerdown="const n=document.createElement('div');n.className='subcategory-item';n.tabIndex=0;n.innerText='Beleza e Cuidados Pessoais';n.onpointerdown=()=>document.body.dataset.chosen='1';document.getElementById('sub').replaceChildren(n)">Moda e beleza</div><div id="sub"></div>`,
          { headers: { 'Content-Type': 'text/html;charset=utf-8' } },
        ),
    );
    await wizardContents.loadURL('https://www2.olx.com.br/desapega');
    const { inspectListingForm } = require('./listing-form.cjs');
    if (
      (await wizardContents.executeJavaScript(`(${inspectListingForm.toString()})()`)).status !==
      'CATEGORY'
    )
      throw new Error('Seletor de categoria não reconhecido.');
    await wizardContents.executeJavaScript(
      `(${attributeDocument.toString()})({action:'category',option:'Moda e beleza'})`,
    );
    await wizardContents.executeJavaScript(
      `(${attributeDocument.toString()})({action:'category',option:'Beleza e Cuidados Pessoais'})`,
    );
    if (!(await wizardContents.executeJavaScript("document.body.dataset.chosen==='1'")))
      throw new Error('Hierarquia de categoria não selecionada.');
    await win.webContents.executeJavaScript(
      "window.multiBrowser.configureListingAI({key:'sk-fixture-only-00000000000000',enabled:true})",
    );
    const missingCondition = await win.webContents.executeJavaScript(
      `window.multiBrowser.reviewListing('${listing.id}',${listing.revision})`,
    );
    if (!missingCondition[0].errors.includes('condição do produto'))
      throw new Error('Revisão não exigiu a condição antes de abrir a OLX.');
    let conditionStopped = false;
    try {
      await win.webContents.executeJavaScript(
        `window.multiBrowser.prepareListing('${listing.id}','${a.id}',${listing.revision})`,
      );
    } catch (error) {
      conditionStopped = error.message.includes('condição do produto');
    }
    if (!conditionStopped) throw new Error('Condição ausente não bloqueou o preparo.');
    await win.webContents.executeJavaScript(
      "window.multiBrowser.configureListingAI({key:'',enabled:false})",
    );
    console.log(
      'MULTIOLX_CATEGORY_CONDITION_OK: hierarquia pública e condição exigida antes do preparo.',
    );
    // Two isolated accounts must reach the final free publication concurrently.
    const { batchFixture } = require('../scripts/listing-batch-fixture.cjs');
    const preparing = new Set(),
      completions = new Map();
    let peakPublishers = 0;
    for (const [owner, ses] of [
      [a.id, sa],
      [b.id, sb],
    ]) {
      ses.protocol.unhandle('https');
      ses.protocol.handle('https', (request) => {
        const url = new URL(request.url);
        if (url.hostname === 'www2.olx.com.br') {
          preparing.add(owner);
          peakPublishers = Math.max(peakPublishers, preparing.size);
        }
        if (url.searchParams.has('done')) {
          if (url.searchParams.get('shipping') !== 'off') throw Error('Entrega ainda ativa');
          completions.set(owner, (completions.get(owner) || 0) + 1);
          preparing.delete(owner);
        }
        return new Response(batchFixture(request.url), {
          headers: { 'Content-Type': 'text/html;charset=utf-8' },
        });
      });
    }
    let parallelDraft = await win.webContents.executeJavaScript(
      'window.multiBrowser.createListing()',
    );
    parallelDraft.base = { ...listing.base, title: 'Publicação paralela local' };
    parallelDraft.photos = listing.photos;
    parallelDraft.targets = [a.id, b.id];
    parallelDraft = await win.webContents.executeJavaScript(
      `window.multiBrowser.saveListing(${JSON.stringify(parallelDraft)})`,
    );
    await win.webContents.executeJavaScript(
      `window.multiBrowser.publishListings('${parallelDraft.id}',${parallelDraft.revision})`,
    );
    await listingService.wait();
    const batchResult = listingService.batchState();
    if (
      peakPublishers !== 2 ||
      completions.get(a.id) !== 1 ||
      completions.get(b.id) !== 1 ||
      batchResult.jobs.some((j) => j.status !== 'SUBMITTED')
    )
      throw new Error(
        'Publicação paralela falhou: ' +
          JSON.stringify({ peakPublishers, completions: [...completions], batchResult }),
      );
    await win.webContents.executeJavaScript(
      `window.multiBrowser.publishListings('${parallelDraft.id}',${parallelDraft.revision})`,
    );
    await listingService.wait();
    if (completions.get(a.id) !== 1 || completions.get(b.id) !== 1)
      throw Error('Envio duplicado após conclusão');
    console.log(
      'MULTIOLX_PARALLEL_PUBLISH_OK: duas contas simultâneas, entrega desmarcada, confirmação, opção gratuita e finalização única.',
    );
    const listingBytes = await fs.readFile(path.join(root, 'announcements.enc'));
    if (listingBytes.includes(Buffer.from('Produto local de teste')))
      throw new Error('Anúncio foi salvo sem criptografia.');
    console.log(
      'MULTIOLX_LISTINGS_OK: herança, variações, revisão de duas contas, fotos, preparo sem publicar e envio explícito sem repetição.',
    );
    const fbFixture = createProfile('Marketplace fixture', 'facebook');
    profiles.push(fbFixture);
    await saveCatalog();
    const fbSession = await openSession(fbFixture.id);
    const { facebookMarketplaceFixture } = require('../scripts/facebook-marketplace-fixture.cjs');
    fbSession.protocol.handle(
      'https',
      () =>
        new Response(facebookMarketplaceFixture(), {
          headers: { 'Content-Type': 'text/html;charset=utf-8' },
        }),
    );
    const fbView = await ensureChat(fbFixture.id);
    for (let i = 0; i < 50 && inbox.accounts.get(fbFixture.id)?.status !== 'READY'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await readInbox(fbFixture.id);
    }
    const fbRows = inboxState().conversations.filter((c) => c.profileId === fbFixture.id);
    if (
      fbRows.length !== 2 ||
      fbRows.some((c) => c.externalId === '999') ||
      fbRows[0].platform !== 'facebook-marketplace'
    )
      throw Error('A pasta Marketplace não foi lida isoladamente do Messenger pessoal.');
    await win.webContents.executeJavaScript('render()');
    await openConversation(fbRows.find((c) => c.externalId === '123').key);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (
      displayedView !== fbView ||
      !(await fbView.webContents.executeJavaScript(
        "!!document.querySelector('[contenteditable=true]')",
      ))
    )
      throw Error('A conversa Marketplace não abriu na sessão correta.');
    fbView.webContents.focus();
    fbView.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    fbView.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    for (let i = 0; i < 30; i++) {
      if (
        !displayedView &&
        !(await fbView.webContents.executeJavaScript(
          "!!document.querySelector('[contenteditable=true]')",
        ))
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (
      displayedView ||
      (await fbView.webContents.executeJavaScript(
        "!!document.querySelector('[contenteditable=true]')",
      ))
    )
      throw Error('Esc deixou uma conversa Marketplace ativa em segundo plano.');
    await fbView.webContents.executeJavaScript('fixtureNewMessage()');
    for (let i = 0; i < 20; i++) {
      await readInbox(fbFixture.id);
      if (
        inboxState().conversations.find(
          (c) => c.profileId === fbFixture.id && c.externalId === '123',
        )?.attention === 'unread'
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (
      inboxState().conversations.find((c) => c.profileId === fbFixture.id && c.externalId === '123')
        ?.attention !== 'unread'
    )
      throw Error('Nova mensagem Marketplace foi marcada como lida em segundo plano.');
    if (listingService.summary().profiles.some((p) => p.id === fbFixture.id))
      throw Error('Conta Facebook foi oferecida como destino de anúncio OLX.');
    await fbView.webContents.executeJavaScript('fixtureNativeInbox()');
    const nativeRows = await facebookCall(fbView, { action: 'read' });
    if (
      nativeRows.status !== 'READY' ||
      nativeRows.conversations.length !== 2 ||
      nativeRows.conversations[0].externalId !== '123' ||
      !nativeRows.conversations[1].externalId.startsWith('marketplace-buy-')
    )
      throw Error(
        'Lista principal Marketplace perdeu a identidade da conversa ou importou uma linha pessoal.',
      );
    await win.webContents.executeJavaScript(`window.multiBrowser.remove('${fbFixture.id}')`);
    console.log(
      'MULTIOLX_FACEBOOK_MARKETPLACE_OK: pasta exclusiva, mensagens pessoais excluídas, autoria, abertura, Esc e novas não lidas.',
    );
    const disposable = await win.webContents.executeJavaScript(
      "window.multiBrowser.create('Perfil para remover')",
    );
    const disposableSession = await openSession(disposable.id);
    disposableSession.protocol.handle(
      'https',
      () =>
        new Response('<h1>Perfil descartável local</h1>', {
          headers: { 'Content-Type': 'text/html' },
        }),
    );
    await disposableSession.cookies.set({
      url: 'https://fixture.test/',
      name: 'remove-fixture',
      value: 'temporary',
    });
    await saveCookies(disposable.id, disposableSession);
    let disposableDraft = listingService.catalog.create();
    disposableDraft.targets = [a.id, disposable.id];
    disposableDraft.overrides[disposable.id] = { price: '30' };
    await listingService.persist();
    await win.webContents.executeJavaScript(`window.multiBrowser.open('${disposable.id}')`);
    await win.webContents.executeJavaScript('render()');
    await win.webContents.executeJavaScript(
      'document.querySelector(\'[aria-label="Remover perfil Perfil para remover"]\').click()',
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (
      displayedView.getVisible() ||
      !(await win.webContents.executeJavaScript(
        "document.getElementById('removeProfileDialog').open",
      ))
    )
      throw Error('Confirmação de remoção ficou escondida atrás da página.');
    await win.webContents.executeJavaScript(
      "document.getElementById('cancelRemoveProfile').click()",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!profiles.some((p) => p.id === disposable.id) || !displayedView.getVisible())
      throw Error('Cancelar removeu o perfil ou ocultou sua página.');
    await win.webContents.executeJavaScript(
      'document.querySelector(\'[aria-label="Remover perfil Perfil para remover"]\').click()',
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    await win.webContents.executeJavaScript(
      "document.getElementById('confirmRemoveProfile').click()",
    );
    for (let i = 0; i < 60; i++) {
      if (
        !(await win.webContents.executeJavaScript(
          "document.getElementById('removeProfileDialog').open",
        ))
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (
      profiles.some((p) => p.id === disposable.id) ||
      !profiles.some((p) => p.id === a.id) ||
      views.has(disposable.id) ||
      sessions.has(disposable.id) ||
      listingService.catalog.find(disposableDraft.id).targets.includes(disposable.id) ||
      (await disposableSession.cookies.get({ url: 'https://fixture.test/' })).length ||
      nativeFs.existsSync(path.join(root, `session-${disposable.id}.enc`))
    )
      throw Error('Remoção não limpou perfil, página, sessão ou rascunhos.');
    console.log(
      'MULTIOLX_PROFILE_REMOVE_OK: confirmação, cancelamento, perfil ativo, sessão e rascunhos sem afetar outra conta.',
    );
    app.quit();
  }
  if (
    webMode &&
    (process.argv.includes('--web-self-test') || process.argv.includes('--web-restore-test'))
  ) {
    await require('./web-smoke.cjs').runWebSmoke({
      app,
      BrowserWindow,
      root,
      port: webAccess.port,
      openSession,
      views,
      nativeImage,
      restore: process.argv.includes('--web-restore-test'),
    });
  }
  if (process.argv.includes('--self-test-restore')) {
    if (
      !removedProfiles.some((p) => p.name === 'Perfil para remover') ||
      profiles.some((p) => p.name === 'Perfil para remover')
    )
      throw Error('O perfil removido reapareceu após reiniciar.');
    const id = profiles[0]?.id;
    if (!id) throw new Error('Catálogo não sobreviveu ao reinício.');
    const restoredListing = listingService.catalog.drafts.find(
      (d) => d.base.title === 'Produto local de teste',
    );
    const restoredBatch = listingService.catalog.drafts.find(
      (d) => d.base.title === 'Publicação paralela local',
    );
    if (
      !restoredBatch ||
      Object.values(restoredBatch.deliveries).some((d) => d.state !== 'SUBMITTED')
    )
      throw Error('Resultados do lote não foram preservados após reiniciar.');
    if (
      !restoredListing ||
      restoredListing.base.description !== 'Descrição base atualizada' ||
      !Object.values(restoredListing.deliveries).some((d) => d.state === 'UNCERTAIN')
    )
      throw new Error('Rascunho ou resultado de envio não foi restaurado.');
    const raw = await fs.readFile(path.join(root, `session-${id}.enc`));
    if (raw.includes(Buffer.from('local-fixture-only')))
      throw new Error('Snapshot não está criptografado.');
    // Discard only the native cookies in this disposable fixture profile, then
    // exercise the real startup restoration path in a second app process.
    await session
      .fromPartition(`persist:account-${id}`)
      .clearStorageData({ storages: ['cookies'] });
    const restored = await openSession(id);
    if (
      (await restored.cookies.get({ url: 'https://fixture.test/' }))[0]?.value !==
      'local-fixture-only'
    )
      throw new Error('Sessão não foi restaurada após reiniciar o aplicativo.');
    console.log(
      'MULTIOLX_BROWSER_RESTART_OK: catálogo e sessão criptografada restaurados em outro processo.',
    );
    app.quit();
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', async (_event, args) => {
    await initialization;
    if (args.includes('--verify-facebook-integration'))
      void (async () => {
        const profile = profiles.find((p) => p.provider === 'facebook');
        if (!profile) throw Error('Facebook não conectado.');
        await showUnifiedInbox();
        await refreshInbox();
        const deadline = Date.now() + 40000;
        while (Date.now() < deadline && inbox.accounts.get(profile.id)?.status !== 'READY')
          await new Promise((resolve) => setTimeout(resolve, 250));
        const state = inboxState();
        await fs.writeFile(
          path.resolve('artifacts/facebook-unified-verification.json'),
          JSON.stringify(
            {
              accounts: state.accounts,
              facebook: state.conversations.filter((c) => c.platform === 'facebook-marketplace')
                .length,
              olx: state.conversations.filter((c) => c.platform !== 'facebook-marketplace').length,
              mode,
              displayed: !!displayedView,
              diagnostic: chatViews.get(profile.id)?.facebookDiagnostic,
            },
            null,
            2,
          ),
        );
        await fs.writeFile(
          path.resolve('artifacts/browser-marketplace-unified.png'),
          (await win.webContents.capturePage()).toPNG(),
        );
      })().catch((error) => console.log('FACEBOOK_UNIFIED_VERIFY_FAILED ' + error.message));
    if (args.includes('--inspect-facebook-inbox'))
      void (async () => {
        const profile = profiles.find((p) => p.provider === 'facebook');
        if (!profile) throw Error('Conecte o Facebook primeiro.');
        const view = await acquirePage(profile.id);
        active = profile.id;
        mode = 'individual';
        display(view);
        if (
          !view.webContents.getURL().startsWith('https://www.facebook.com/marketplace/inbox') &&
          !view.webContents.getURL().startsWith('https://www.facebook.com/messages/marketplace')
        )
          await Promise.race([
            view.webContents.loadURL('https://www.facebook.com/marketplace/inbox/'),
            new Promise((resolve) => setTimeout(resolve, 6000)),
          ]);
        delete require.cache[require.resolve('./facebook-marketplace.cjs')];
        const { inspectMarketplaceDocument } = require('./facebook-marketplace.cjs');
        const command = JSON.parse(
          await fs
            .readFile(path.resolve('artifacts/facebook-command.json'), 'utf8')
            .catch(() => '{"action":"inspect"}'),
        );
        const result = await view.webContents.executeJavaScript(
          `(${inspectMarketplaceDocument.toString()})(${JSON.stringify(command)})`,
        );
        await fs.writeFile(
          path.resolve('artifacts/facebook-inbox-inspection.json'),
          JSON.stringify(result, null, 2),
        );
      })().catch((error) => console.log('FACEBOOK_INBOX_INSPECTION_FAILED ' + error.message));
    if (args.includes('--diagnose-facebook'))
      void (async () => {
        const profile = profiles.find((p) => p.provider === 'facebook');
        const view = profile && views.get(profile.id);
        if (!view) throw Error('Abra o perfil Facebook Marketplace.');
        const page = await view.webContents.executeJavaScript(`({
          origin:location.origin,path:location.pathname,title:document.title,
          login:!!document.querySelector('input[type=password]'),
          checkpoint:/checkpoint|two_step_verification/.test(location.pathname),
          marketplaceLinks:[...document.querySelectorAll('a[href]')].filter(a=>a.href.startsWith('https://www.facebook.com/marketplace/')).slice(0,15).map(a=>({text:a.innerText.slice(0,100),path:new URL(a.href).pathname})),
        })`);
        await fs.writeFile(
          path.resolve('artifacts/facebook-connection.json'),
          JSON.stringify(page, null, 2),
        );
      })().catch((error) => console.log('FACEBOOK_DIAGNOSTIC_FAILED ' + error.message));
    if (args.includes('--connect-facebook'))
      void connectFacebook()
        .then(() => win.webContents.executeJavaScript('render()'))
        .catch((error) => send({ message: error.message, error: true }));
    if (args.includes('--diagnose-ui'))
      void (async () => {
        const ui = await win.webContents.executeJavaScript(`({
          ready: document.readyState,
          profileButtons: document.getElementById('profiles')?.children.length,
          status: document.getElementById('status')?.textContent,
        })`);
        await fs.writeFile(
          path.resolve('artifacts/ui-startup-diagnostic.json'),
          JSON.stringify(
            {
              root,
              profiles: profiles.map((p) => ({ id: p.id, name: p.name })),
              ui,
            },
            null,
            2,
          ),
        );
      })().catch((error) => console.log('MULTIOLX_UI_DIAGNOSTIC_FAILED ' + error.message));
    if (args.includes('--listing-walkthrough'))
      void (async () => {
        const command = JSON.parse(
          await fs.readFile(path.resolve('artifacts/listing-walkthrough-command.json'), 'utf8'),
        );
        delete require.cache[require.resolve('./listing-walkthrough.cjs')];
        const walkthrough = require('./listing-walkthrough.cjs');
        await win.webContents.executeJavaScript('window.multiListings?.save()');
        const result = { drafts: listingService.summary().drafts, profiles };
        let view;
        if (command.owner) {
          profileId(command.owner);
          if (!profiles.some((p) => p.id === command.owner)) throw new Error('Conta inválida.');
          view = views.get(command.owner);
          if (command.action === 'open' || command.action === 'navigate') {
            walkthroughOwner = command.owner;
            view = await acquirePage(command.owner);
            chatViews.delete(command.owner);
            inbox.update(command.owner, { status: 'PAUSED' });
            publishInbox();
            active = command.owner;
            mode = 'individual';
            display(view);
            send({
              mode,
              profileId: active,
              source: profiles.find((p) => p.id === active).name,
              location: 'Publicação · passo a passo',
            });
            const target =
              command.action === 'open' ? 'https://www2.olx.com.br/desapega' : command.url;
            if (!allowedUrl(target) || !new URL(target).hostname.endsWith('olx.com.br'))
              throw new Error('Destino inválido.');
            await view.webContents.loadURL(target);
          } else if (['click', 'fill'].includes(command.action)) {
            if (!view || view !== displayedView)
              throw new Error('A conta precisa estar aberta na etapa esperada.');
            result.action = await view.webContents.executeJavaScript(
              `(${walkthrough.actOnDocument.toString()})(${JSON.stringify(command)})`,
            );
          } else if (command.action === 'photos') {
            if (!view || view !== displayedView) throw new Error('Abra a conta esperada.');
            const photos = await listingService.photoPayload(command.draftId);
            result.action = await view.webContents.executeJavaScript(
              `(${walkthrough.actOnDocument.toString()})(${JSON.stringify({ ...command, photos })})`,
            );
          } else if (command.action === 'product-condition') {
            result.action = await win.webContents.executeJavaScript(
              `window.multiListings.setCondition(${JSON.stringify(command.draftId)},${JSON.stringify(command.value)})`,
            );
            result.drafts = listingService.summary().drafts;
          } else if (command.action === 'product-facts') {
            result.action = await win.webContents.executeJavaScript(
              `window.multiListings.setFacts(${JSON.stringify(command.draftId)},${JSON.stringify(command.value)})`,
            );
            result.drafts = listingService.summary().drafts;
          } else if (command.action === 'ai-test') {
            result.action = await win.webContents.executeJavaScript(
              'window.multiBrowser.testListingAI()',
            );
          } else if (command.action === 'check-background') {
            walkthroughOwner = command.owner;
            result.action = await listingService.checkBackground(command.draftId);
          } else if (command.action === 'batch-state') {
            result.action = listingService.batchState();
            result.diagnostics = listingService.diagnostics();
            result.drafts = listingService.summary().drafts;
          } else if (command.action === 'resolve-unsent') {
            result.action = await win.webContents.executeJavaScript(
              `window.multiBrowser.resolveListing(${JSON.stringify(command.draftId)},${JSON.stringify(command.owner)},'not_sent')`,
            );
          } else if (command.action === 'publish-all') {
            result.action = await win.webContents.executeJavaScript(
              `window.multiListings.publishSaved(${JSON.stringify(command.draftId)})`,
            );
          } else if (command.action === 'prepare') {
            result.action = await win.webContents.executeJavaScript(
              `window.multiListings.prepare(${JSON.stringify(command.draftId)},${JSON.stringify(command.owner)},${command.confirmedUnsent === 'true'})`,
            );
            result.drafts = listingService.summary().drafts;
            view = views.get(command.owner);
          } else if (command.action === 'verify') {
            if (!view || view !== displayedView) throw new Error('Abra a conta esperada.');
            result.action = await listingService.verifyPublished(
              command.draftId,
              command.owner,
              view.webContents,
            );
            result.drafts = listingService.summary().drafts;
            walkthroughOwner = null;
          }
          if (view && !view.webContents.isDestroyed()) {
            await new Promise((resolve) => setTimeout(resolve, command.waitMs || 500));
            result.page = await view.webContents.executeJavaScript(
              `(${walkthrough.snapshotDocument.toString()})()`,
            );
            const frame = await Promise.race([
              view.webContents
                .capturePage(undefined, { stayHidden: true, stayAwake: true })
                .catch(() => null),
              new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
            ]);
            if (frame)
              await fs.writeFile(path.resolve('artifacts/listing-walkthrough.png'), frame.toPNG());
          }
        }
        await fs.writeFile(
          path.resolve('artifacts/listing-walkthrough-result.json'),
          JSON.stringify(result, null, 2),
        );
      })().catch(async (error) => {
        await fs.writeFile(
          path.resolve('artifacts/listing-walkthrough-result.json'),
          JSON.stringify({ error: error.message }),
        );
      });
    if (args.includes('--show-listings'))
      void (async () => {
        await win.webContents.executeJavaScript('window.multiListings.open()');
        await new Promise((resolve) => setTimeout(resolve, 400));
        await fs.writeFile(
          path.resolve('artifacts/browser-listings-live.png'),
          (await win.webContents.capturePage()).toPNG(),
        );
      })().catch((error) => console.log('LISTINGS_UI_FAILED ' + error.message));
    if (args.includes('--inspect-posting'))
      void (async () => {
        const owner = profiles[0].id;
        const view = await acquirePage(owner);
        chatViews.delete(owner);
        inbox.update(owner, { status: 'PAUSED' });
        publishInbox();
        mode = 'individual';
        active = owner;
        display(view);
        const url = await view.webContents.executeJavaScript(
          `(() => { const link=[...document.querySelectorAll('a[href]')].find(n=>/Anunciar gr[áa]tis/i.test(n.innerText)); return link?.href || null; })()`,
        );
        if (!url || !allowedUrl(url)) {
          await view.webContents.loadURL('https://www.olx.com.br/');
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const target = await view.webContents.executeJavaScript(
            `(() => { const n=[...document.querySelectorAll('a,button')].find(n=>/^Anunciar gr[áa]tis$/i.test(n.innerText.trim())); if(!n)return false; n.click();return true; })()`,
          );
          if (!target) throw new Error('Link público de anúncio não encontrado.');
        } else await view.webContents.loadURL(url);
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await view.webContents.executeJavaScript(
          `(() => { const button=[...document.querySelectorAll('button')].find(n=>/^Começar meu anúncio$/i.test(n.innerText.trim()));if(button)button.click(); })()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await view.webContents.executeJavaScript(
          `document.querySelector('button[aria-label="Selecionar categoria Produtos"]')?.click()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const fields = await view.webContents.executeJavaScript(
          `(() => ({origin:location.origin,path:location.pathname,headings:[...document.querySelectorAll('h1,h2,h3')].map(n=>n.innerText),fields:[...document.querySelectorAll('input,textarea,select,button,[role="combobox"]')].map(n=>({tag:n.tagName,type:n.type,name:n.name,id:n.id,test:n.getAttribute('data-testid'),label:n.getAttribute('aria-label'),placeholder:n.getAttribute('placeholder'),text:n.tagName==='BUTTON'?n.innerText:null,accept:n.accept,required:n.required})),labels:[...document.querySelectorAll('label')].map(n=>({for:n.htmlFor,text:n.innerText}))}))()`,
        );
        await fs.writeFile(
          path.resolve('artifacts/posting-form-structure.json'),
          JSON.stringify(fields, null, 2),
        );
        await fs.writeFile(
          path.resolve('artifacts/posting-form.png'),
          (await view.webContents.capturePage()).toPNG(),
        );
      })().catch((error) => console.log('POSTING_INSPECT_FAILED ' + error.message));
    if (args.includes('--restart')) {
      app.relaunch({
        args: process.argv
          .slice(1)
          .filter(
            (arg) =>
              ![
                '--inbox-report',
                '--verify-conversation',
                '--verify-facebook-integration',
                '--inspect-facebook-inbox',
                '--restart',
              ].includes(arg),
          ),
      });
      app.quit();
      return;
    }
    if (args.includes('--verify-inbox-filters'))
      void (async () => {
        await win.webContents.executeJavaScript('window.multiBrowser.unified()');
        const counts = {};
        for (const filter of ['unread', 'awaiting', 'outgoing', '']) {
          await win.webContents.executeJavaScript(
            `document.getElementById('attentionFilter').value=${JSON.stringify(filter)};document.getElementById('attentionFilter').dispatchEvent(new Event('change'))`,
          );
          await new Promise((resolve) => setTimeout(resolve, 200));
          counts[filter || 'all'] = await win.webContents.executeJavaScript(
            "document.querySelectorAll('.conversation-row').length",
          );
          if (filter)
            await fs.writeFile(
              path.resolve(`artifacts/browser-filter-${filter}.png`),
              (await win.webContents.capturePage()).toPNG(),
            );
        }
        await fs.writeFile(
          path.resolve('artifacts/browser-filter-check.json'),
          JSON.stringify(counts, null, 2),
        );
        await fs.writeFile(
          path.resolve('artifacts/browser-inbox-final.png'),
          (await win.webContents.capturePage()).toPNG(),
        );
      })().catch((error) => console.log('MULTIOLX_FILTER_VERIFY_FAILED ' + error.message));
    if (args.includes('--verify-attention') || args.includes('--verify-val'))
      void (async () => {
        const available = inboxState().conversations.filter(
          (c) => c.unread === false && c.lastDirection === 'unknown',
        );
        const candidate = args.includes('--verify-val')
          ? inboxState().conversations.find(
              (c) => c.contact === 'Val' && c.profileName === 'teste 2',
            )
          : available.find((c) => /\?$/.test(c.preview)) || available[0];
        if (!candidate) return;
        await openConversation(candidate.key);
        await new Promise((resolve) => setTimeout(resolve, 6000));
        await readInbox(candidate.profileId);
        const result = inbox.find(candidate.key, profiles);
        const evidence = await views.get(candidate.profileId).webContents
          .executeJavaScript(`(() => {
          const result = (${readChatDocument.toString()})();
          const row = document.getElementById(${JSON.stringify(candidate.externalId)});
          const preview = row?.querySelector('.text-1-5')?.innerText.trim();
          return {hasDetail:!!result.detail,direction:result.detail?.lastDirection,
            detailLength:result.detail?.preview?.length,listLength:preview?.length,
            exactMatch:preview===result.detail?.preview,
            normalizedMatch:preview?.replace(/\\s+/g,' ').trim()===result.detail?.preview?.replace(/\\s+/g,' ').trim(),
            bubbles:document.querySelectorAll('[class~="peer/bubble"]').length};
        })()`);
        if (args.includes('--verify-val'))
          await fs.writeFile(
            path.resolve('artifacts/browser-val-content.png'),
            (await views.get(candidate.profileId).webContents.capturePage()).toPNG(),
          );
        const state = inboxState();
        await fs.writeFile(
          path.resolve('artifacts/browser-attention-check.json'),
          JSON.stringify(
            {
              before: candidate.lastDirection,
              evidence,
              selected: {
                attention: result.attention,
                lastDirection: result.lastDirection,
                unread: result.unread,
              },
              statuses: Object.fromEntries(
                ['unread', 'awaiting', 'outgoing', 'read', 'unknown'].map((status) => [
                  status,
                  state.conversations.filter((c) => c.attention === status).length,
                ]),
              ),
              economy,
              activePages: views.size,
              limit: maxPages,
            },
            null,
            2,
          ),
        );
        mode = 'unified';
        active = null;
        display(null);
        send({ mode, source: '', location: 'Chats unificados', back: false, forward: false });
        await new Promise((resolve) => setTimeout(resolve, 500));
        await fs.writeFile(
          path.resolve('artifacts/browser-attention-live.png'),
          (await win.webContents.capturePage()).toPNG(),
        );
      })().catch((error) => console.log('MULTIOLX_ATTENTION_VERIFY_FAILED ' + error.message));
    if (args.includes('--diagnose'))
      void Promise.all(
        [...views].map(async ([id, view]) => {
          const dom = await view.webContents
            .executeJavaScript(`(${conversationDocument.toString()})()`)
            .catch(() => null);
          const attention = await view.webContents
            .executeJavaScript(
              `(() => {
            const result = (${readChatDocument.toString()})();
            const rows = [...document.querySelectorAll('a[data-testid="chat-list-item"]')];
            const bubbles = [...document.querySelectorAll('[class~="peer/bubble"]')];
            const last = bubbles.at(-1);
            const preview = last?.querySelector('span.whitespace-pre-wrap')?.innerText.trim();
            return {hasDetail:!!result.detail,detailDirection:result.detail?.lastDirection,bubbles:bubbles.length,bubbleClasses:last?.className,
              rawIdMatch:rows.some(r=>r.id===location.search.slice('?chat-id='.length)),
              decodedMatch:rows.some(r=>new URL(r.href).searchParams.get('chat-id')===new URL(location.href).searchParams.get('chat-id')),
              previewMatch:rows.some(r=>r.querySelector('.text-1-5')?.innerText.trim()===preview),
              previewLength:preview?.length};
          })()`,
            )
            .catch(() => null);
          return {
            profile: profiles.find((p) => p.id === id)?.name,
            status: inbox.accounts.get(id)?.status,
            origin: dom?.origin,
            rows: dom?.rows,
            composer: dom?.composer,
            skeletons: dom?.skeletons,
            attention,
          };
        }),
      ).then((pages) =>
        fs.writeFile(
          path.resolve('artifacts/browser-diagnostic.json'),
          JSON.stringify(
            { activePages: views.size, limit: maxPages, profiles: profiles.length, pages },
            null,
            2,
          ),
        ),
      );
    if (win) {
      win.show();
      win.focus();
    }
  });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    listingService?.cancel();
    void webAccess?.close();
    clearInterval(saveTimer);
    clearInterval(inboxTimer);
    scanQueue = [];
    void flushAll(true)
      .then(() => {
        quitting = true;
        for (const popup of popups.keys()) if (!popup.isDestroyed()) popup.destroy();
        for (const view of views.values())
          if (!view.webContents.isDestroyed()) view.webContents.close();
        app.quit();
      })
      .catch(() => {
        quitting = false;
        send({
          message:
            'Não foi possível salvar as sessões. O navegador continua aberto para preservar o login.',
          error: true,
        });
        if (selfTest) app.exit(1);
      });
  });
  app.on('window-all-closed', () => app.quit());
  initialization = app
    .whenReady()
    .then(start)
    .catch((error) => {
      console.error('MultiOLX Browser:', selfTest ? error.stack : error.code || error.message);
      app.exit(1);
    });
}
