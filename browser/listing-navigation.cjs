async function navigatePublisher(contents, url, timeoutMs = 20000) {
  let timer, onReady;
  const ready = new Promise((resolve) => {
    onReady = resolve;
    contents.once?.('dom-ready', onReady);
  });
  try {
    await Promise.race([
      contents.loadURL(url),
      ready,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (!contents.isDestroyed()) contents.stop?.();
          reject(
            new Error('A OLX demorou para abrir a página. Confira esta conta antes de repetir.'),
          );
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error?.code !== 'ERR_ABORTED' && error?.errno !== -3) throw error;
    // OLX can redirect the public listing route before loadURL resolves. Never
    // restart this navigation: the caller still verifies the destination DOM.
    const until = Date.now() + 12000;
    while (!contents.isDestroyed() && contents.isLoadingMainFrame() && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (contents.isDestroyed()) throw error;
    const destination = new URL(contents.getURL());
    if (destination.protocol !== 'https:' || !/(^|\.)olx\.com\.br$/.test(destination.hostname))
      throw error;
  } finally {
    clearTimeout(timer);
    contents.removeListener?.('dom-ready', onReady);
  }
}
module.exports = { navigatePublisher };
