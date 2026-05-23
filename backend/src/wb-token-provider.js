#!/usr/bin/env node
import { createServer } from 'node:http';
import { createWbTokenRefresher } from './lib/wb-token-refresher.js';
import { resolveWbTokenFromBrowser } from './lib/wb-token-browser-resolver.js';

const port = Number(process.env.WB_TOKEN_PROVIDER_PORT ?? 7071);
const host = process.env.WB_TOKEN_PROVIDER_HOST ?? '127.0.0.1';
const refreshMs = Number(process.env.WB_TOKEN_REFRESH_MS ?? 5 * 60 * 1000);
const bearerSecret = process.env.WB_TOKEN_PROVIDER_SECRET ?? '';

function unauthorized(res) {
  res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'unauthorized' }));
}

function checkAuth(req) {
  if (!bearerSecret) return true;
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${bearerSecret}`;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const refresher = createWbTokenRefresher({
  resolveToken: () => resolveWbTokenFromBrowser(),
  refreshMs,
  logger: {
    info: (msg) => console.error(`[wb-token-provider] ${msg}`),
    warn: (msg) => console.error(`[wb-token-provider] ${msg}`),
    error: (msg) => console.error(`[wb-token-provider] ${msg}`),
  },
});

refresher.start();

const server = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';

  if (url === '/health' && method === 'GET') {
    const state = refresher.getState();
    sendJson(res, 200, {
      ok: true,
      has_token: Boolean(state.token),
      updated_at: state.updatedAt,
      last_error: state.lastError,
      refresh_count: state.refreshCount,
    });
    return;
  }

  if (url === '/token' && method === 'GET') {
    if (!checkAuth(req)) {
      unauthorized(res);
      return;
    }

    const state = refresher.getState();
    if (!state.token) {
      sendJson(res, 503, {
        error: 'token_not_ready',
        last_error: state.lastError,
      });
      return;
    }

    sendJson(res, 200, {
      token: state.token,
      cookie: state.cookie,
      pow: state.pow,
      updated_at: state.updatedAt,
    });
    return;
  }

  if (url === '/refresh' && method === 'POST') {
    if (!checkAuth(req)) {
      unauthorized(res);
      return;
    }

    await refresher.refresh();
    const state = refresher.getState();
    sendJson(res, state.token ? 200 : 503, {
      ok: Boolean(state.token),
      updated_at: state.updatedAt,
      last_error: state.lastError,
      refresh_count: state.refreshCount,
    });
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
});

server.listen(port, host, () => {
  console.error(`[wb-token-provider] listening on http://${host}:${port}`);
});

function shutdown() {
  refresher.stop();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
