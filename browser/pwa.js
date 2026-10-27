(() => {
  const api = window.multiBrowser;
  if (!window.multiWeb || !api) return;
  const button = document.createElement('button');
  button.id = 'appNotifications';
  button.className = 'app-notifications';
  button.innerHTML =
    '<span>Aplicativo e notificações</span><span class="app-unread" hidden></span>';
  document.querySelector('aside').insertBefore(button, document.getElementById('profiles'));
  const dialog = document.createElement('dialog');
  dialog.className = 'app-settings-dialog';
  dialog.setAttribute('aria-labelledby', 'appSettingsTitle');
  dialog.innerHTML = `<div class="app-settings-heading"><h2 id="appSettingsTitle">Aplicativo no celular</h2><button type="button" aria-label="Fechar configurações do aplicativo">×</button></div>
    <p>Instale o MultiOLX na tela inicial para abrir como um aplicativo.</p>
    <button type="button" id="installApp">Instalar aplicativo</button>
    <p id="installHelp">No Chrome do Android, use o menu ⋮ e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.</p>
    <h3>Novas mensagens</h3><p>Receba avisos neste dispositivo mesmo com o MultiOLX fechado. Os avisos não mostram o conteúdo das conversas.</p>
    <button type="button" id="enablePush">Ativar notificações</button>
    <button type="button" id="testPush" hidden>Enviar notificação de teste</button>
    <p class="app-settings-hint">O contador representa conversas não lidas. No Android, o número ou ponto no ícone depende do navegador e das configurações do celular.</p>
    <p id="pushStatus" role="status"></p>`;
  document.body.append(dialog);
  const el = (id) => document.getElementById(id);
  dialog.querySelector('[aria-label="Fechar configurações do aplicativo"]').onclick = () =>
    dialog.close();
  button.onclick = () => dialog.showModal();
  let prompt,
    subscription,
    registration,
    unread = [],
    generation = 0;
  const tags = new Map();
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const status = (text) => {
    el('pushStatus').textContent = text;
  };
  async function request(route, input) {
    const session = await fetch('/api/session', { cache: 'no-store' });
    if (!session.ok) throw Error('Entre novamente para alterar as notificações.');
    const { csrf } = await session.json();
    const response = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(input),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Não foi possível configurar as notificações.');
    return data;
  }
  const refresh = () => {
    el('enablePush').textContent = subscription
      ? 'Desativar notificações neste dispositivo'
      : 'Ativar notificações';
    el('testPush').hidden = !subscription;
  };
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const installState = () => {
    el('installApp').hidden = !!standalone();
    if (standalone()) el('installHelp').textContent = 'Você está usando o aplicativo instalado.';
  };
  installState();
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    prompt = event;
  });
  window.addEventListener('appinstalled', () => {
    prompt = null;
    el('installApp').hidden = true;
    el('installHelp').textContent = 'Aplicativo instalado na tela inicial.';
  });
  el('installApp').onclick = async () => {
    if (!prompt) {
      el('installHelp').textContent =
        'Abra o menu ⋮ do Chrome no celular e toque em “Instalar aplicativo” ou “Adicionar à tela inicial”. No iPhone, use Compartilhar → Adicionar à Tela de Início.';
      return;
    }
    await prompt.prompt();
    await prompt.userChoice;
    prompt = null;
  };
  async function tag(key) {
    if (!tags.has(key)) {
      const bytes = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)),
      );
      tags.set(
        key,
        'multiolx-' +
          btoa(String.fromCharCode(...bytes))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '')
            .slice(0, 20),
      );
    }
    return tags.get(key);
  }
  async function updateBadge(state) {
    unread = state.conversations.filter((c) => c.unread === true);
    const current = ++generation,
      count = unread.length;
    const counter = button.querySelector('.app-unread');
    counter.textContent = count > 99 ? '99+' : String(count);
    counter.hidden = !count;
    button.setAttribute(
      'aria-label',
      `Aplicativo e notificações${count ? ` · ${count} conversas não lidas` : ''}`,
    );
    try {
      const unreadTags = await Promise.all(unread.map((c) => tag(c.key)));
      if (current !== generation) return;
      const worker = registration?.active;
      worker?.postMessage({ type: 'badge', count, unreadTags });
      if (count) await navigator.setAppBadge?.(count);
      else await navigator.clearAppBadge?.();
    } catch {}
  }
  api.onInbox(updateBadge);
  const ready =
    'serviceWorker' in navigator
      ? navigator.serviceWorker
          .register('/sw.js', { scope: '/' })
          .then(() => navigator.serviceWorker.ready)
          .then(async (value) => {
            registration = value;
            if (!supported) {
              status('Este navegador não oferece notificações push. Use Chrome no Android.');
              return;
            }
            const existing = await registration.pushManager.getSubscription();
            if (existing && Notification.permission === 'granted') {
              await request('/api/push/subscribe', { subscription: existing.toJSON() });
              subscription = existing;
              status('Notificações ativadas neste dispositivo.');
            } else if (Notification.permission === 'denied')
              status(
                'Notificações bloqueadas. Permita nas configurações do navegador para ativar.',
              );
            else status('Notificações desativadas neste dispositivo.');
            refresh();
            await updateBadge(await api.inbox());
          })
          .catch(() =>
            status('Não foi possível iniciar as notificações. Confira a conexão e abra novamente.'),
          )
      : Promise.resolve(status('Este navegador não suporta a instalação e as notificações.'));
  async function disable() {
    await ready;
    const current = subscription || (await registration?.pushManager?.getSubscription());
    if (current) {
      await current.unsubscribe();
      subscription = null;
      await request('/api/push/unsubscribe', { endpoint: current.endpoint }).catch(() => {});
    }
    registration?.active?.postMessage({ type: 'badge', count: 0, unreadTags: [] });
    refresh();
    status('Notificações desativadas neste dispositivo.');
  }
  window.multiPwa = { disable };
  el('enablePush').disabled = !supported;
  el('enablePush').onclick = async () => {
    try {
      if (subscription) {
        await disable();
        return;
      }
      // Request within the click gesture, before network work (required by mobile browsers).
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        status('Permita as notificações no navegador para receber os avisos.');
        return;
      }
      await ready;
      if (!registration) throw Error('O aplicativo ainda não está pronto. Recarregue a página.');
      const response = await fetch('/api/push', { cache: 'no-store' });
      const config = await response.json();
      if (!response.ok || !config.available)
        throw Error('As notificações ainda não estão disponíveis no servidor.');
      const bytes = Uint8Array.from(
        atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')),
        (c) => c.charCodeAt(0),
      );
      const next =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        }));
      await request('/api/push/subscribe', { subscription: next.toJSON() });
      subscription = next;
      status('Notificações ativadas. Você pode fechar o aplicativo.');
      refresh();
      await updateBadge(await api.inbox());
    } catch (error) {
      status(error.message || 'Não foi possível ativar as notificações.');
    }
  };
  el('testPush').onclick = async () => {
    try {
      await request('/api/push/test', { endpoint: subscription.endpoint });
      status('Notificação de teste enviada para este dispositivo.');
    } catch (error) {
      status(error.message);
    }
  };
  async function openFromNotice(key) {
    await api.unified();
    if (typeof key === 'string' && key.length <= 1200) await api.openConversation(key);
  }
  navigator.serviceWorker?.addEventListener('message', (event) => {
    if (event.data?.type === 'open-conversation')
      void openFromNotice(event.data.key).catch((error) => {
        el('status').textContent = error.message;
      });
  });
  const params = new URL(location.href).searchParams;
  if (params.get('app') === '1' || params.has('conversation'))
    void openFromNotice(params.get('conversation')).catch((error) => {
      el('status').textContent = error.message;
    });
})();
