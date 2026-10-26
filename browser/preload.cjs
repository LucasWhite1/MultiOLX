const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'multiServerShell',
  process.argv.includes('--multiolx-server-shell'),
);
// This bridge belongs only to the packaged local toolbar, never to an OLX page.
contextBridge.exposeInMainWorld('multiBrowser', {
  list: () => ipcRenderer.invoke('profiles:list'),
  connectFacebook: () => ipcRenderer.invoke('facebook:connect'),
  create: (name) => ipcRenderer.invoke('profiles:create', name),
  rename: (id, name) => ipcRenderer.invoke('profiles:rename', id, name),
  remove: (id) => ipcRenderer.invoke('profiles:remove', id),
  profileDialog: (visible) => ipcRenderer.invoke('profiles:dialog', visible),
  open: (id) => ipcRenderer.invoke('profiles:open', id),
  close: () => ipcRenderer.invoke('profiles:close'),
  navigate: (action) => ipcRenderer.invoke('browser:navigate', action),
  economy: (value) => ipcRenderer.invoke('browser:economy', value),
  inbox: () => ipcRenderer.invoke('inbox:state'),
  unified: () => ipcRenderer.invoke('inbox:show'),
  refreshInbox: () => ipcRenderer.invoke('inbox:refresh'),
  openConversation: (key) => ipcRenderer.invoke('inbox:open', key),
  budget: (value) => ipcRenderer.invoke('browser:budget', value),
  listings: () => ipcRenderer.invoke('listings:show'),
  listListings: () => ipcRenderer.invoke('listings:list'),
  scanManagedAds: (owners) => ipcRenderer.invoke('listings:managed-scan', owners),
  managedAds: () => ipcRenderer.invoke('listings:managed-state'),
  reviewAdRemoval: (keys) => ipcRenderer.invoke('listings:managed-review', keys),
  removeAds: (token) => ipcRenderer.invoke('listings:managed-delete', token),
  cancelAdManagement: () => ipcRenderer.invoke('listings:managed-cancel'),
  listingAI: () => ipcRenderer.invoke('listings:ai-status'),
  configureListingAI: (input) => ipcRenderer.invoke('listings:ai-configure', input),
  testListingAI: () => ipcRenderer.invoke('listings:ai-test'),
  createListing: () => ipcRenderer.invoke('listings:create'),
  saveListing: (input) => ipcRenderer.invoke('listings:save', input),
  pickListingPhotos: () => ipcRenderer.invoke('listings:photos'),
  reviewListing: (id, revision) => ipcRenderer.invoke('listings:review', id, revision),
  prepareListing: (id, owner, revision) =>
    ipcRenderer.invoke('listings:prepare', id, owner, revision),
  fillListing: (id, owner, revision) => ipcRenderer.invoke('listings:fill', id, owner, revision),
  resolveListing: (id, owner, result) => ipcRenderer.invoke('listings:resolve', id, owner, result),
  submitListing: (id, owner, revision) =>
    ipcRenderer.invoke('listings:submit', id, owner, revision),
  publishListings: (id, revision) => ipcRenderer.invoke('listings:publish-all', id, revision),
  listingBatch: () => ipcRenderer.invoke('listings:batch-state'),
  cancelListingBatch: () => ipcRenderer.invoke('listings:batch-cancel'),
  onListingBatch: (listener) =>
    ipcRenderer.on('listings:batch', (_event, state) => listener(state)),
  onResources: (listener) =>
    ipcRenderer.on('browser:resources', (_event, state) => listener(state)),
  onInbox: (listener) => ipcRenderer.on('inbox:state', (_event, state) => listener(state)),
  onState: (listener) => ipcRenderer.on('browser:state', (_event, state) => listener(state)),
});
