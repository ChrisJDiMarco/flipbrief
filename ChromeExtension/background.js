const DEFAULTS = { host: '127.0.0.1', port: 51760, token: '' };

async function getConfig() {
  const stored = await chrome.storage.local.get(['host', 'port', 'token']);
  return {
    host: stored.host || DEFAULTS.host,
    port: Number(stored.port) || DEFAULTS.port,
    token: stored.token || DEFAULTS.token,
  };
}

function endpoint(config, path) {
  return `http://${config.host}:${config.port}${path}`;
}

async function ping() {
  const config = await getConfig();
  try {
    const response = await fetch(endpoint(config, '/health'));
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const body = await response.json();
    return { ok: body.name === 'FlipBrief', body };
  } catch (error) {
    return { ok: false, reason: error.message || String(error) };
  }
}

async function activeYouTubePayload() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) throw new Error('No active tab.');
  const url = new URL(tab.url);
  if (!url.hostname.includes('youtube.com') && url.hostname !== 'youtu.be') {
    throw new Error('Open a YouTube video or playlist first.');
  }
  return {
    url: tab.url,
    title: tab.title || '',
    source: 'extension',
    requestedAt: new Date().toISOString(),
  };
}

async function addToFlipBrief(payload) {
  const config = await getConfig();
  if (!config.token) throw new Error('Missing pairing token.');
  const response = await fetch(endpoint(config, '/youtube/add'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'prepare') {
        sendResponse({ ok: true, status: await ping(), payload: await activeYouTubePayload() });
      } else if (message.type === 'add') {
        sendResponse({ ok: true, result: await addToFlipBrief(message.payload) });
      } else if (message.type === 'ping') {
        sendResponse({ ok: true, status: await ping() });
      } else {
        sendResponse({ ok: false, error: 'Unknown message.' });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }
  })();
  return true;
});
