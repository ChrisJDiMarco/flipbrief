const titleEl = document.getElementById('title');
const statusEl = document.getElementById('status');
const addEl = document.getElementById('add');
const errorEl = document.getElementById('error');
const optionsEl = document.getElementById('options');

let payload = null;

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

async function prepare() {
  const response = await send({ type: 'prepare' });
  if (!response || !response.ok) {
    addEl.disabled = true;
    titleEl.textContent = 'Nothing to add.';
    showError((response && response.error) || 'Could not read this tab.');
    return;
  }
  payload = response.payload;
  titleEl.textContent = payload.title || payload.url;
  statusEl.textContent = response.status.ok ? 'Connected' : 'Open app or pair token';
  addEl.disabled = !response.status.ok;
}

async function add() {
  if (!payload) return;
  addEl.disabled = true;
  addEl.textContent = 'Adding...';
  const response = await send({ type: 'add', payload });
  if (!response || !response.ok) {
    addEl.disabled = false;
    addEl.textContent = 'Add';
    showError((response && response.error) || 'Add failed.');
    return;
  }
  addEl.textContent = 'Added';
  window.setTimeout(() => window.close(), 700);
}

addEl.addEventListener('click', add);
optionsEl.addEventListener('click', () => chrome.runtime.openOptionsPage());
prepare();
