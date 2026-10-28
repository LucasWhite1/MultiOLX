async function navigatePublisher(contents, url) {
  try {
    await contents.loadURL(url);
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
  }
}
module.exports = { navigatePublisher };
