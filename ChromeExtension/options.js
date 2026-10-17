const hostEl = document.getElementById('host');
const portEl = document.getElementById('port');
const tokenEl = document.getElementById('token');
const saveEl = document.getElementById('save');
const testEl = document.getElementById('test');
const statusEl = document.getElementById('status');

async function load() {
  const stored = await chrome.storage.local.get(['host', 'port', 'token']);
  hostEl.value = stored.host || '127.0.0.1';
  portEl.value = stored.port || 51760;
  tokenEl.value = stored.token || '';
}

function config() {
  return {
    host: hostEl.value.trim() || '127.0.0.1',
    port: Number(portEl.value) || 51760,
    token: tokenEl.value.trim(),
  };
}

async function save() {
  await chrome.storage.local.set(config());
  statusEl.textContent = 'Saved.';
}

async function test() {
  const c = config();
  try {
    const response = await fetch(`http://${c.host}:${c.port}/health`);
    const body = await response.json();
    statusEl.textContent = body.name === 'FlipBrief' ? 'Connected.' : 'Unexpected app response.';
  } catch (error) {
    statusEl.textContent = error.message || String(error);
  }
}

saveEl.addEventListener('click', save);
testEl.addEventListener('click', test);
load();
