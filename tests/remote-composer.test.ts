import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const { createRemoteBrowser } = createRequire(import.meta.url)('../browser/remote-browser.cjs');
function fixture() {
  const events: any[] = [],
    texts: string[] = [];
  let current: any = {
    key: 'account:chat',
    profileId: 'account',
    url: 'https://chat.olx.com.br/?chat-id=chat',
  };
  const contents = {
    id: 1,
    isDestroyed: () => false,
    focus: () => {},
    getZoomFactor: () => 1,
    executeJavaScript: async (code: string) =>
      code.includes('"phase":"check"')
        ? { empty: true }
        : code.includes('"phase":"submit"')
          ? { point: { x: 100, y: 100 } }
          : { focused: true },
    insertText: async (text: string) => {
      texts.push(text);
    },
    sendInputEvent: (e: any) => events.push(e),
  };
  const remote = createRemoteBrowser({
    window: () => ({ show() {}, focus() {} }),
    view: () => ({ webContents: contents }),
    popups: new Map(),
    owner: () => 'account',
    busy: () => false,
    conversation: () => current,
  });
  const command = {
    target: 1,
    action: 'chat-send',
    conversationKey: 'account:chat',
    text: 'Olá, disponível!',
    requestId: crypto.randomUUID(),
  };
  return {
    remote,
    command,
    events,
    texts,
    change: () => (current = { ...current, key: 'account:other' }),
    marketplace: () =>
      (current = {
        ...current,
        platform: 'facebook-marketplace',
        url: 'https://www.facebook.com/messages/t/123/',
      }),
    contents,
  };
}
it('envia Unicode uma vez e devolve o resultado anterior ao repetir uma requisição', async () => {
  const f = fixture();
  expect(await f.remote.input(f.command)).toEqual({ submitted: true, confirmed: true });
  expect(await f.remote.input(f.command)).toEqual({ submitted: true, confirmed: true });
  expect(f.texts).toEqual(['Olá, disponível!']);
  expect(f.events.filter((e) => e.type === 'keyDown')).toHaveLength(1);
  await expect(f.remote.input({ ...f.command, text: 'Outra mensagem' })).rejects.toThrow(
    'já foi utilizado',
  );
});
it('envia no Facebook por um único clique no botão nativo e não usa Enter', async () => {
  const f = fixture();
  f.marketplace();
  expect(await f.remote.input(f.command)).toEqual({ submitted: true, confirmed: true });
  expect(await f.remote.input(f.command)).toEqual({ submitted: true, confirmed: true });
  expect(f.events.filter((e) => e.type === 'mouseDown')).toHaveLength(1);
  expect(f.events.filter((e) => e.type === 'keyDown')).toHaveLength(0);
  expect(f.texts).toHaveLength(1);
});
it('recusa conversa ou página que mudou antes de enviar', async () => {
  const f = fixture();
  await expect(f.remote.input({ ...f.command, target: 2 })).rejects.toThrow('página mudou');
  f.change();
  await expect(f.remote.input(f.command)).rejects.toThrow('conversa mudou');
  expect(f.texts).toHaveLength(0);
});
it('verifica disponibilidade do campo sem inserir texto nem apertar Enter', async () => {
  const f = fixture();
  expect(await f.remote.input({ ...f.command, action: 'chat-check' })).toEqual({
    ready: true,
    empty: true,
  });
  expect(f.texts).toHaveLength(0);
  expect(f.events).toHaveLength(0);
});
it('não aperta Enter se outra conversa for aberta enquanto o campo recebe foco', async () => {
  const f = fixture();
  f.contents.executeJavaScript = async () => {
    f.change();
    return { focused: true } as any;
  };
  await expect(f.remote.input(f.command)).rejects.toThrow('conversa mudou');
  expect(f.events).toHaveLength(0);
});
