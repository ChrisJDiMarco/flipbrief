import { afterEach, describe, expect, it } from 'vitest';
import bridgeServer from '../src/main/bridge-server.js';

const { createBridgeServer } = bridgeServer;

let server;

function listen(testServer) {
  return new Promise((resolve) => {
    testServer.listen(0, '127.0.0.1', () => {
      const { port } = testServer.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(() => {
  if (server) server.close();
  server = null;
});

describe('loopback bridge', () => {
  it('serves health without auth', async () => {
    server = createBridgeServer({ token: 'secret', onAdd: async () => ({}), health: () => ({ name: 'FlipBrief' }) });
    const base = await listen(server);
    const response = await fetch(`${base}/health`);
    await expect(response.json()).resolves.toEqual({ name: 'FlipBrief' });
  });

  it('requires bearer token and validates payload', async () => {
    server = createBridgeServer({
      token: 'secret',
      onAdd: async (payload) => ({ ok: true, url: payload.url }),
      health: () => ({ name: 'FlipBrief' }),
    });
    const base = await listen(server);

    expect((await fetch(`${base}/youtube/add`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/youtube/add`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      body: '{}',
    })).status).toBe(400);

    const ok = await fetch(`${base}/youtube/add`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    });
    await expect(ok.json()).resolves.toEqual({ ok: true, url: 'https://youtu.be/dQw4w9WgXcQ' });
  });
});
