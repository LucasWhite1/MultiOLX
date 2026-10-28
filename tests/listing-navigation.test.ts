import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const { navigatePublisher } = createRequire(import.meta.url)('../browser/listing-navigation.cjs');
it('continua quando o DOM está pronto mesmo se o carregamento completo não terminar', async () => {
  const contents = Object.assign(new EventEmitter(), {
    loadURL: () => {
      queueMicrotask(() => contents.emit('dom-ready'));
      return new Promise(() => {});
    },
    isDestroyed: () => false,
  });
  await navigatePublisher(contents, 'https://conta.olx.com.br/anuncios/publicados', 50);
  expect(contents.listenerCount('dom-ready')).toBe(0);
});
it('limita a espera de uma página travada e remove os observadores', async () => {
  const stop = vi.fn();
  const contents = Object.assign(new EventEmitter(), {
    loadURL: () => new Promise(() => {}),
    isDestroyed: () => false,
    stop,
  });
  await expect(navigatePublisher(contents, 'https://conta.olx.com.br/', 10)).rejects.toThrow(
    'demorou',
  );
  expect(stop).toHaveBeenCalledOnce();
  expect(contents.listenerCount('dom-ready')).toBe(0);
});
it('aceita redirecionamento OLX abortado sem repetir a navegação', async () => {
  const contents = {
    loadURL: vi.fn().mockRejectedValue({ code: 'ERR_ABORTED' }),
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    getURL: () => 'https://conta.olx.com.br/anuncios/publicados',
  };
  await navigatePublisher(contents, contents.getURL());
  expect(contents.loadURL).toHaveBeenCalledTimes(1);
});
it('não oculta falhas de rede ou navegação abortada para fora da OLX', async () => {
  for (const [error, url] of [
    [{ code: 'ERR_CONNECTION_REFUSED' }, 'https://conta.olx.com.br/'],
    [{ code: 'ERR_ABORTED' }, 'https://olx.com.br.evil.test/'],
  ]) {
    await expect(
      navigatePublisher(
        {
          loadURL: async () => {
            throw error;
          },
          isDestroyed: () => false,
          isLoadingMainFrame: () => false,
          getURL: () => url,
        },
        'https://conta.olx.com.br/',
      ),
    ).rejects.toBe(error);
  }
});
