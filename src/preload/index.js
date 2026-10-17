const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flipbrief', {
  appMeta: () => ipcRenderer.invoke('app-meta'),
  keysStatus: () => ipcRenderer.invoke('keys-status'),
  saveKey: (keyName, value) => ipcRenderer.invoke('save-key', { keyName, value }),
  clearKey: (keyName) => ipcRenderer.invoke('clear-key', keyName),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  queueImport: (payload) => ipcRenderer.invoke('queue-import', payload),
  listJobs: () => ipcRenderer.invoke('list-jobs'),
  listBooks: () => ipcRenderer.invoke('list-books'),
  readBook: (videoId) => ipcRenderer.invoke('read-book', videoId),
  mediaUrl: (filePath) => ipcRenderer.invoke('media-url', filePath),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  openExtensionFolder: () => ipcRenderer.invoke('open-extension-folder'),
  regenerateToken: () => ipcRenderer.invoke('regenerate-token'),
  onBooksChanged: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('books-changed', listener);
    return () => ipcRenderer.removeListener('books-changed', listener);
  },
  onJobChanged: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('job-changed', listener);
    return () => ipcRenderer.removeListener('job-changed', listener);
  },
});
