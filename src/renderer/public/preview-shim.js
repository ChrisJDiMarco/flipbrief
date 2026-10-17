(() => {
  if (window.flipbrief) return;

  const defaults = Object.freeze({
    latestCount: 20,
    pageCount: 5,
    openAIModel: 'gpt-4.1-mini',
  });
  const unavailable = Object.freeze({
    ok: false,
    unavailable: true,
    message: 'Available in the FlipBrief desktop app.',
  });
  const noopSubscription = () => () => {};

  const api = Object.freeze({
    appMeta: () => Promise.resolve({
      name: 'FlipBrief',
      version: 'Cabinet preview',
      dataDir: 'Desktop app only',
      bridge: { port: 'Preview', token: '' },
    }),
    keysStatus: () => Promise.resolve({}),
    saveKey: () => Promise.resolve(unavailable),
    clearKey: () => Promise.resolve(unavailable),
    getSettings: () => Promise.resolve({ ...defaults }),
    saveSettings: (settings) => Promise.resolve({ ...defaults, ...settings }),
    queueImport: () => Promise.resolve(unavailable),
    listJobs: () => Promise.resolve([]),
    listBooks: () => Promise.resolve([]),
    readBook: () => Promise.resolve(null),
    mediaUrl: () => Promise.resolve(''),
    openDataFolder: () => Promise.resolve(unavailable),
    openExtensionFolder: () => Promise.resolve(unavailable),
    regenerateToken: () => Promise.resolve(unavailable),
    onBooksChanged: noopSubscription,
    onJobChanged: noopSubscription,
  });

  Object.defineProperty(window, 'flipbrief', { value: api });
})();
