const { chatComposerDocument } = require('./remote-composer.cjs');
function createRemoteBrowser({
  window: windowFor,
  view: viewFor,
  popups,
  owner,
  busy,
  conversation = () => null,
}) {
  const submissions = new Map();
  let queue = Promise.resolve(),
    viewport = { width: 1100, height: 780 };
  function target() {
    const popup = [...popups.keys()]
      .filter((p) => !p.isDestroyed() && popups.get(p) === owner())
      .at(-1);
    if (popup) return { contents: popup.webContents, window: popup, popup: true };
    const view = viewFor();
    if (!view || view.webContents.isDestroyed()) return null;
    return { contents: view.webContents, window: windowFor(), view, popup: false };
  }
  function size(t) {
    if (t.popup) t.window.setContentSize(viewport.width, viewport.height);
    else t.view.setBounds({ x: 0, y: 0, ...viewport });
  }
  const serialize = (fn) => {
    const next = queue.catch(() => {}).then(fn);
    queue = next;
    return next;
  };
  async function composer(contents, context) {
    const result = await contents.executeJavaScript(
      `(()=>{try{return (${chatComposerDocument.toString()})(${JSON.stringify(context)})}catch(error){return {error:error.message}}})()`,
    );
    if (result.error) {
      if (result.diagnostic)
        console.warn('REMOTE_COMPOSER_LAYOUT ' + JSON.stringify(result.diagnostic));
      throw Error(result.error);
    }
    return result;
  }
  return {
    frame: () =>
      serialize(async () => {
        const t = target();
        if (!t) return null;
        size(t);
        t.window.show();
        t.window.focus();
        t.contents.setBackgroundThrottling(false);
        await new Promise((resolve) => setTimeout(resolve, 80));
        const image = await t.contents.capturePage(undefined, {
          stayHidden: false,
          stayAwake: true,
        });
        if (image.isEmpty()) return null;
        return { id: t.contents.id, popup: t.popup, ...image.getSize(), bytes: image.toJPEG(75) };
      }),
    input: (command) =>
      serialize(async () => {
        const t = target();
        if (!t) throw Error('Selecione uma conta ou conversa.');
        if (command.target !== t.contents.id)
          throw Error('A página mudou. Aguarde a imagem atualizar.');
        if (busy(owner())) throw Error('A conta está publicando. Aguarde a conclusão.');
        if (command.action === 'viewport') {
          if (
            !Number.isInteger(command.width) ||
            !Number.isInteger(command.height) ||
            command.width < 360 ||
            command.width > 1600 ||
            command.height < 320 ||
            command.height > 1200
          )
            throw Error('Dimensões inválidas.');
          viewport = { width: command.width, height: command.height };
          size(t);
          return { ok: true };
        }
        if (command.action === 'close-popup') {
          if (!t.popup) throw Error('Não há janela de login aberta.');
          t.window.close();
          return { ok: true };
        }
        t.window.show();
        t.window.focus();
        t.contents.focus();
        if (command.action === 'chat-send' || command.action === 'chat-check') {
          const context = conversation();
          if (
            t.popup ||
            !context ||
            context.key !== command.conversationKey ||
            context.profileId !== owner()
          )
            throw Error('A conversa mudou. Reabra a conversa antes de enviar.');
          if (command.action === 'chat-check')
            return {
              ready: true,
              ...(await composer(t.contents, { ...context, phase: 'check' })),
            };
          if (
            typeof command.text !== 'string' ||
            !command.text.trim() ||
            command.text.length > 10000 ||
            !/^[a-f0-9-]{36}$/i.test(command.requestId || '')
          )
            throw Error('Mensagem inválida.');
          const key = t.contents.id + ':' + command.requestId;
          const previous = submissions.get(key);
          if (previous) {
            if (previous.text !== command.text || previous.conversationKey !== context.key)
              throw Error('Este envio já foi utilizado.');
            return previous.result;
          }
          const focused = await composer(t.contents, { ...context, phase: 'focus' });
          if (!focused.focused) throw Error('Não foi possível selecionar o campo de mensagem.');
          if (target()?.contents !== t.contents || conversation()?.key !== context.key)
            throw Error('A conversa mudou durante o envio. Confira o campo antes de continuar.');
          await t.contents.insertText(command.text);
          if (target()?.contents !== t.contents || conversation()?.key !== context.key)
            throw Error('A conversa mudou durante o envio. O texto não foi enviado.');
          // Register before dispatch: a lost HTTP response must never repeat Enter.
          const result = { submitted: true, confirmed: false };
          submissions.set(key, { text: command.text, conversationKey: context.key, result });
          if (submissions.size > 100) submissions.delete(submissions.keys().next().value);
          t.contents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
          t.contents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 100));
            const state = await composer(t.contents, { ...context, phase: 'check' }).catch(
              () => null,
            );
            if (state?.empty) {
              result.confirmed = true;
              break;
            }
          }
          return result;
        } else if (command.action === 'click') {
          if (
            !Number.isFinite(command.x) ||
            !Number.isFinite(command.y) ||
            command.x < 0 ||
            command.y < 0 ||
            command.x >= viewport.width ||
            command.y >= viewport.height
          )
            throw Error('Posição inválida.');
          const point = {
            x: Math.round(command.x),
            y: Math.round(command.y),
            button: 'left',
            clickCount: 1,
          };
          t.contents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
          t.contents.sendInputEvent({ type: 'mouseDown', ...point });
          t.contents.sendInputEvent({ type: 'mouseUp', ...point });
        } else if (command.action === 'text') {
          if (typeof command.text !== 'string' || command.text.length > 16000)
            throw Error('Texto inválido.');
          await t.contents.insertText(command.text);
        } else if (command.action === 'key') {
          if (
            ![
              'Enter',
              'Tab',
              'Escape',
              'Backspace',
              'Delete',
              'ArrowUp',
              'ArrowDown',
              'ArrowLeft',
              'ArrowRight',
              'Home',
              'End',
              'PageUp',
              'PageDown',
              'a',
              'c',
              'v',
              'x',
            ].includes(command.key)
          )
            throw Error('Tecla inválida.');
          const modifiers = command.control ? ['control'] : command.shift ? ['shift'] : [];
          const keyCode =
            { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }[
              command.key
            ] || command.key;
          t.contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
          t.contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
        } else if (command.action === 'scroll') {
          if (!Number.isFinite(command.delta) || Math.abs(command.delta) > 2000)
            throw Error('Rolagem inválida.');
          t.contents.sendInputEvent({
            type: 'mouseWheel',
            x: Math.round(viewport.width / 2),
            y: Math.round(viewport.height / 2),
            deltaY: -command.delta,
            deltaX: 0,
            canScroll: true,
          });
        } else throw Error('Entrada inválida.');
        return { ok: true };
      }),
  };
}
module.exports = { createRemoteBrowser };
