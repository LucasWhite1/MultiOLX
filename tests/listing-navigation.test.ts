import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { navigatePublisher } = createRequire(import.meta.url)('../browser/listing-navigation.cjs');
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
