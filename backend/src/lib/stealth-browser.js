// REST client for the stealth browser service — a sandboxed Firefox instance with
// anti-detection patches applied at the engine level (navigator, WebGL, AudioContext,
// WebRTC spoofed before any JS runs). Used as a drop-in for headless Chromium on
// marketplaces that fingerprint and block standard browser automation.
//
// API shapes (verified against running container /openapi.json):
//   POST /tabs           { userId, sessionKey, url? } -> { tabId }
//   POST /tabs/:id/navigate { userId, url }
//   POST /tabs/:id/evaluate { userId, expression } -> { ok, result }
//   DELETE /tabs/:id?userId=

const DEFAULT_URL = process.env.STEALTH_BROWSER_URL ?? process.env.CAMOFOX_URL ?? 'http://127.0.0.1:9377';
const ACCESS_KEY = process.env.STEALTH_BROWSER_KEY ?? process.env.CAMOFOX_ACCESS_KEY ?? '';
const USER_ID = process.env.STEALTH_BROWSER_USER ?? process.env.CAMOFOX_USER_ID ?? 'tenderhack';

function authHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (ACCESS_KEY) h.Authorization = `Bearer ${ACCESS_KEY}`;
  return h;
}

async function request(method, path, { body, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${DEFAULT_URL}${path}`, {
      method,
      headers: authHeaders(),
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await resp.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { ok: resp.ok, status: resp.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function isAvailable({ timeoutMs = 2500 } = {}) {
  try {
    const res = await request('GET', '/health', { timeoutMs });
    return res.ok && res.json?.ok === true;
  } catch {
    return false;
  }
}

async function openTab(url, { sessionKey = 'default', timeoutMs = 60000 } = {}) {
  const res = await request('POST', '/tabs', {
    body: { userId: USER_ID, sessionKey, url },
    timeoutMs,
  });
  const tabId = res.json?.tabId;
  if (!res.ok || !tabId) {
    throw new Error(`stealth-browser openTab failed: status=${res.status} body=${(res.text ?? '').slice(0, 200)}`);
  }
  return tabId;
}

async function navigate(tabId, url, { timeoutMs = 60000 } = {}) {
  const res = await request('POST', `/tabs/${tabId}/navigate`, {
    body: { userId: USER_ID, url },
    timeoutMs,
  });
  if (!res.ok) throw new Error(`stealth-browser navigate failed: status=${res.status}`);
  return res.json;
}

async function evaluate(tabId, expression, { timeoutMs = 45000 } = {}) {
  const res = await request('POST', `/tabs/${tabId}/evaluate`, {
    body: { userId: USER_ID, expression },
    timeoutMs,
  });
  if (!res.ok || res.json?.ok === false) {
    throw new Error(`stealth-browser evaluate failed: status=${res.status} body=${(res.text ?? '').slice(0, 200)}`);
  }
  return res.json?.result;
}

async function getPage(tabId, { timeoutMs = 45000 } = {}) {
  const raw = await evaluate(
    tabId,
    'JSON.stringify({title: document.title, html: document.documentElement.outerHTML})',
    { timeoutMs },
  );
  try {
    return JSON.parse(raw);
  } catch {
    return { title: '', html: typeof raw === 'string' ? raw : '' };
  }
}

async function scroll(tabId, { amount = 800, timeoutMs = 15000 } = {}) {
  return request('POST', `/tabs/${tabId}/scroll`, {
    body: { userId: USER_ID, direction: 'down', amount },
    timeoutMs,
  });
}

async function waitMs(tabId, ms, { timeoutMs = 30000 } = {}) {
  await new Promise((r) => setTimeout(r, ms));
  return evaluate(tabId, 'document.readyState', { timeoutMs }).catch(() => null);
}

async function closeTab(tabId, { timeoutMs = 10000 } = {}) {
  try {
    await request('DELETE', `/tabs/${tabId}?userId=${encodeURIComponent(USER_ID)}`, { timeoutMs });
  } catch { /* tab will time out on its own */ }
}

export { isAvailable, openTab, navigate, evaluate, getPage, scroll, waitMs, closeTab, DEFAULT_URL };
