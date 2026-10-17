const { app, BrowserWindow, ipcMain, shell, safeStorage, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pathToFileURL } = require('url');
const { createBridgeServer } = require('./bridge-server');
const {
  extractVideoId,
  extractPlaylistId,
  coerceLatestCount,
  parseCaptionXml,
  parseCaptionJson3,
  compactTranscript,
  cleanText,
} = require('../shared/youtube');
const { normalizePlan } = require('../shared/ai-plan');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'flipbrief-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

const APP_NAME = 'FlipBrief';
const DEFAULT_PORT = 51760;
const KEY_NAMES = ['YOUTUBE_API_KEY', 'OPENAI_API_KEY'];
const jobs = new Map();

let mainWindow;
let bridgeServer;
let bridgePort = DEFAULT_PORT;
let configCache = null;

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function dataRoot() {
  return app.getPath('userData');
}

function dataPath(...parts) {
  return path.join(dataRoot(), ...parts);
}

function ensureDirs() {
  for (const dir of [dataPath('books'), dataPath('images'), dataPath('transcripts')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function defaultConfig() {
  return {
    bridgeToken: crypto.randomBytes(24).toString('hex'),
    settings: {
      latestCount: 20,
      pageCount: 5,
      openAIModel: 'gpt-4.1-mini',
    },
    keys: {},
  };
}

function configFile() {
  return dataPath('config.json');
}

function loadConfig() {
  if (configCache) return configCache;
  ensureDirs();
  try {
    configCache = { ...defaultConfig(), ...JSON.parse(fs.readFileSync(configFile(), 'utf8')) };
  } catch (_) {
    configCache = defaultConfig();
    saveConfig();
  }
  configCache.settings = { ...defaultConfig().settings, ...(configCache.settings || {}) };
  configCache.keys = configCache.keys || {};
  return configCache;
}

function saveConfig() {
  fs.writeFileSync(configFile(), JSON.stringify(configCache || defaultConfig(), null, 2));
}

function encryptValue(value) {
  if (safeStorage.isEncryptionAvailable()) {
    return { encrypted: true, value: safeStorage.encryptString(value).toString('base64') };
  }
  return { plaintext: true, value: Buffer.from(value, 'utf8').toString('base64') };
}

function decryptValue(stored) {
  if (!stored) return null;
  if (stored.encrypted && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(stored.value, 'base64'));
  }
  if (stored.plaintext) return Buffer.from(stored.value, 'base64').toString('utf8');
  return null;
}

function getKey(name) {
  const config = loadConfig();
  return decryptValue(config.keys[name]) || process.env[name] || '';
}

function mediaUrl(filePath) {
  return pathToFileURL(filePath).toString();
}

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1060,
    minHeight: 700,
    title: APP_NAME,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f3efe7',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function registerMediaProtocol() {
  protocol.handle('flipbrief-file', async (request) => {
    try {
      const url = new URL(request.url);
      const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const resolved = path.resolve(filePath);
      const root = path.resolve(dataRoot());
      const project = path.resolve(__dirname);
      if (!resolved.startsWith(root) && !resolved.startsWith(project)) {
        return new Response('forbidden', { status: 403 });
      }
      if (!fs.existsSync(resolved)) return new Response('not found', { status: 404 });
      const ext = path.extname(resolved).toLowerCase();
      const type = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
      return new Response(Readable.toWeb(fs.createReadStream(resolved)), {
        headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' },
      });
    } catch (error) {
      return new Response(error.message || String(error), { status: 500 });
    }
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

async function startBridge() {
  if (bridgeServer) {
    try { bridgeServer.close(); } catch (_) {}
  }
  const config = loadConfig();
  bridgeServer = createBridgeServer({
    token: config.bridgeToken,
    health: () => ({ name: APP_NAME, version: app.getVersion(), port: bridgePort }),
    onAdd: async (payload) => queueImport({
      sourceUrl: payload.url,
      latestCount: payload.latestCount || 1,
      title: payload.title,
      source: 'extension',
    }),
  });

  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + 20; port += 1) {
    try {
      await listen(bridgeServer, port);
      bridgePort = port;
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No available loopback port for extension bridge.');
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': `${APP_NAME}/0.1` } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchPlaylistVideos(playlistId, count) {
  const key = getKey('YOUTUBE_API_KEY');
  if (!key) throw new Error('Missing YOUTUBE_API_KEY for playlist imports.');
  const videos = [];
  let pageToken = '';
  while (videos.length < count) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('maxResults', String(Math.min(50, count - videos.length)));
    url.searchParams.set('key', key);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const payload = await fetchJson(url);
    for (const item of payload.items || []) {
      const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
      if (!videoId) continue;
      videos.push({
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: cleanText(item.snippet?.title || videoId),
        channelTitle: cleanText(item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || ''),
        publishedAt: item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || now(),
        thumbnailUrl: item.snippet?.thumbnails?.maxres?.url || item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || thumbnailUrl(videoId),
      });
    }
    pageToken = payload.nextPageToken || '';
    if (!pageToken) break;
  }
  return videos
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, count);
}

async function videoFromUrl(sourceUrl, title) {
  const videoId = extractVideoId(sourceUrl);
  if (!videoId) throw new Error('No YouTube video ID found.');
  let meta = {};
  try {
    meta = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`);
  } catch (_) {
    meta = {};
  }
  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: cleanText(title || meta.title || videoId),
    channelTitle: cleanText(meta.author_name || ''),
    publishedAt: now(),
    thumbnailUrl: thumbnailUrl(videoId),
  };
}

function thumbnailUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function bookPath(videoId) {
  return dataPath('books', `${videoId}.json`);
}

function imagePath(videoId, name, ext = 'png') {
  return dataPath('images', `${videoId}-${name}.${ext}`);
}

function writeBook(book) {
  const next = { ...book, updatedAt: now() };
  fs.writeFileSync(bookPath(book.videoId), JSON.stringify(next, null, 2));
  emit('books-changed', { book: next });
  return next;
}

function readBooks() {
  ensureDirs();
  return fs.readdirSync(dataPath('books'))
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dataPath('books'), file), 'utf8'));
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
}

function extractObjectAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;
  const start = source.indexOf('{', markerIndex);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, i + 1));
    }
  }
  return null;
}

async function fetchTranscript(videoId) {
  const watch = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    },
  });
  if (!watch.ok) throw new Error(`YouTube watch page HTTP ${watch.status}`);
  const html = await watch.text();
  const player = extractObjectAfter(html, 'ytInitialPlayerResponse');
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) return [];
  const picked = tracks.find((track) => String(track.languageCode || '').startsWith('en')) || tracks[0];
  const url = new URL(picked.baseUrl);
  url.searchParams.set('fmt', 'json3');
  const captions = await fetch(url, { headers: { 'User-Agent': `${APP_NAME}/0.1` } });
  if (!captions.ok) throw new Error(`Caption track HTTP ${captions.status}`);
  const text = await captions.text();
  try {
    return parseCaptionJson3(text);
  } catch (_) {
    return parseCaptionXml(text);
  }
}

async function askAI(video, segments, desired) {
  const key = getKey('OPENAI_API_KEY');
  if (!key) return normalizePlan(null, segments, desired);
  const model = loadConfig().settings.openAIModel || 'gpt-4.1-mini';
  const prompt = [
    'Turn this YouTube transcript into a succinct visual flipbook plan.',
    'Return only JSON shaped like {"summary":"...","moments":[{"startSec":12,"heading":"...","body":"..."}]}.',
    `Use exactly ${desired} moments unless the transcript is too short. Keep each body under 45 words.`,
    `Title: ${video.title}`,
    compactTranscript(segments),
  ].join('\n\n');

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: prompt }),
    });
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const payload = await response.json();
    const text = payload.output_text
      || (payload.output || []).flatMap((item) => item.content || []).map((part) => part.text || '').join('\n')
      || payload.choices?.[0]?.message?.content
      || '';
    return normalizePlan(text, segments, desired);
  } catch (error) {
    return normalizePlan(null, segments, desired);
  }
}

async function downloadImage(url, outPath) {
  const response = await fetch(url, { headers: { 'User-Agent': `${APP_NAME}/0.1` } });
  if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureFrame(videoId, startSec, outPath) {
  const frame = new BrowserWindow({
    width: 960,
    height: 540,
    show: false,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
  });
  try {
    const html = encodeURIComponent(`<!doctype html>
      <html>
        <body style="margin:0;background:#111;overflow:hidden">
          <iframe width="960" height="540"
            src="https://www.youtube.com/embed/${videoId}?start=${Math.max(0, Math.floor(startSec))}&autoplay=1&mute=1&controls=0&rel=0"
            allow="autoplay; encrypted-media; picture-in-picture"
            style="border:0;width:960px;height:540px"></iframe>
        </body>
      </html>`);
    await frame.loadURL(`data:text/html;charset=utf-8,${html}`);
    await wait(2800);
    const image = await frame.webContents.capturePage();
    fs.writeFileSync(outPath, image.toPNG());
    return outPath;
  } finally {
    frame.destroy();
  }
}

async function imageForMoment(video, moment, index) {
  const out = imagePath(video.videoId, `moment-${index + 1}`);
  try {
    return await captureFrame(video.videoId, moment.startSec || 0, out);
  } catch (_) {
    const jpg = imagePath(video.videoId, `fallback-${index + 1}`, 'jpg');
    return downloadImage(video.thumbnailUrl || thumbnailUrl(video.videoId), jpg);
  }
}

async function processVideo(video, job, desired) {
  let book = writeBook({
    id: video.videoId,
    videoId: video.videoId,
    url: video.url,
    title: video.title,
    channelTitle: video.channelTitle,
    publishedAt: video.publishedAt,
    status: 'processing',
    summary: '',
    pages: [],
    createdAt: now(),
  });

  try {
    const segments = await fetchTranscript(video.videoId);
    fs.writeFileSync(dataPath('transcripts', `${video.videoId}.json`), JSON.stringify(segments, null, 2));
    if (!segments.length) {
      return writeBook({
        ...book,
        status: 'skipped',
        error: 'No public transcript found.',
        pages: [{
          type: 'cover',
          heading: video.title,
          body: 'No public transcript found for this video.',
          imagePath: await downloadImage(video.thumbnailUrl || thumbnailUrl(video.videoId), imagePath(video.videoId, 'cover', 'jpg')),
        }],
      });
    }

    const plan = await askAI(video, segments, desired);
    const moments = plan.moments.slice(0, desired);
    const pages = [];
    const coverPath = await downloadImage(video.thumbnailUrl || thumbnailUrl(video.videoId), imagePath(video.videoId, 'cover', 'jpg'));
    pages.push({
      type: 'cover',
      heading: video.title,
      body: video.channelTitle ? `${video.channelTitle} - ${new Date(video.publishedAt).toLocaleDateString()}` : new Date(video.publishedAt).toLocaleDateString(),
      imagePath: coverPath,
    });

    for (let i = 0; i < moments.length; i += 1) {
      const moment = moments[i];
      pages.push({
        type: 'moment',
        startSec: moment.startSec,
        heading: moment.heading,
        body: moment.body,
        imagePath: await imageForMoment(video, moment, i),
      });
    }

    pages.push({
      type: 'takeaway',
      heading: 'What matters',
      body: plan.summary,
    });

    book = writeBook({ ...book, status: 'complete', summary: plan.summary, pages });
    return book;
  } catch (error) {
    return writeBook({ ...book, status: 'error', error: error.message || String(error) });
  }
}

async function runJob(job, title) {
  job.status = 'running';
  emit('job-changed', job);
  const count = coerceLatestCount(job.latestCount);
  const desired = Math.max(4, Math.min(8, Number(loadConfig().settings.pageCount) || 5));

  try {
    const playlistId = extractPlaylistId(job.sourceUrl);
    const videoId = extractVideoId(job.sourceUrl);
    const videos = playlistId && !videoId
      ? await fetchPlaylistVideos(playlistId, count)
      : [await videoFromUrl(job.sourceUrl, title)];

    job.total = videos.length;
    emit('job-changed', job);

    for (let i = 0; i < videos.length; i += 1) {
      job.current = i + 1;
      job.currentTitle = videos[i].title;
      emit('job-changed', job);
      const book = await processVideo(videos[i], job, desired);
      if (book.status === 'error' || book.status === 'skipped') job.errors.push(`${videos[i].title}: ${book.error}`);
    }
    job.status = job.errors.length && job.errors.length === videos.length ? 'error' : 'complete';
    job.completedAt = now();
  } catch (error) {
    job.status = 'error';
    job.errors.push(error.message || String(error));
    job.completedAt = now();
  }
  emit('job-changed', job);
  return job;
}

function queueImport({ sourceUrl, latestCount, title, source = 'app' }) {
  const job = {
    id: id('job'),
    source,
    sourceUrl,
    latestCount: coerceLatestCount(latestCount),
    status: 'queued',
    createdAt: now(),
    errors: [],
  };
  jobs.set(job.id, job);
  emit('job-changed', job);
  runJob(job, title);
  return { ok: true, jobId: job.id, message: 'Added to FlipBrief.' };
}

function setupIpc() {
  ipcMain.handle('app-meta', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    dataRoot: dataRoot(),
    extensionPath: path.join(path.dirname(path.dirname(__dirname)), 'ChromeExtension'),
    bridge: { host: '127.0.0.1', port: bridgePort, token: loadConfig().bridgeToken },
  }));

  ipcMain.handle('keys-status', () => Object.fromEntries(KEY_NAMES.map((name) => [name, Boolean(getKey(name))])));
  ipcMain.handle('save-key', (_, { keyName, value }) => {
    if (!KEY_NAMES.includes(keyName)) throw new Error('Unknown key.');
    const config = loadConfig();
    if (!value) delete config.keys[keyName];
    else config.keys[keyName] = { ...encryptValue(String(value).trim()), updatedAt: now() };
    saveConfig();
    return { ok: true };
  });
  ipcMain.handle('clear-key', (_, keyName) => {
    if (!KEY_NAMES.includes(keyName)) throw new Error('Unknown key.');
    const config = loadConfig();
    delete config.keys[keyName];
    saveConfig();
    return { ok: true };
  });

  ipcMain.handle('get-settings', () => loadConfig().settings);
  ipcMain.handle('save-settings', (_, settings) => {
    const config = loadConfig();
    config.settings = {
      ...config.settings,
      latestCount: coerceLatestCount(settings.latestCount),
      pageCount: Math.max(4, Math.min(8, Number(settings.pageCount) || 5)),
      openAIModel: cleanText(settings.openAIModel || config.settings.openAIModel || 'gpt-4.1-mini'),
    };
    saveConfig();
    return config.settings;
  });

  ipcMain.handle('queue-import', (_, payload) => queueImport(payload));
  ipcMain.handle('list-jobs', () => Array.from(jobs.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  ipcMain.handle('list-books', () => readBooks());
  ipcMain.handle('read-book', (_, videoId) => {
    const file = bookPath(videoId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  });
  ipcMain.handle('media-url', (_, filePath) => mediaUrl(filePath));
  ipcMain.handle('open-data-folder', () => shell.openPath(dataRoot()));
  ipcMain.handle('open-extension-folder', () => shell.openPath(path.join(path.dirname(path.dirname(__dirname)), 'ChromeExtension')));
  ipcMain.handle('regenerate-token', async () => {
    const config = loadConfig();
    config.bridgeToken = crypto.randomBytes(24).toString('hex');
    saveConfig();
    await startBridge();
    return { host: '127.0.0.1', port: bridgePort, token: config.bridgeToken };
  });
}

app.whenReady().then(async () => {
  ensureDirs();
  loadConfig();
  registerMediaProtocol();
  setupIpc();
  await startBridge();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (bridgeServer) bridgeServer.close();
  if (process.platform !== 'darwin') app.quit();
});
