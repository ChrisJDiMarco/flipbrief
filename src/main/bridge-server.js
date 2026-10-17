const http = require('http');

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': typeof payload === 'string' ? 'text/plain' : 'application/json',
    'Access-Control-Allow-Origin': 'chrome-extension://*',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function bearer(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function createBridgeServer({ token, onAdd, health }) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'OPTIONS') return send(res, 204, '');

      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, health());
      }

      if (req.method === 'POST' && url.pathname === '/youtube/add') {
        if (!token || bearer(req) !== token) return send(res, 401, { error: 'Unauthorized' });
        const raw = await readBody(req);
        let payload;
        try {
          payload = JSON.parse(raw);
        } catch (_) {
          return send(res, 400, { error: 'Malformed JSON' });
        }
        if (!payload || typeof payload.url !== 'string' || !payload.url.trim()) {
          return send(res, 400, { error: 'Missing url' });
        }
        const result = await onAdd(payload);
        return send(res, 200, result);
      }

      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      return send(res, error.status || 500, { error: error.message || String(error) });
    }
  });

  return server;
}

module.exports = {
  createBridgeServer,
  readBody,
};
