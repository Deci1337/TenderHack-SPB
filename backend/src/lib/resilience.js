const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
];

function createSemaphore(limit) {
  let active = 0;
  const queue = [];

  const acquire = () =>
    new Promise((resolve) => {
      if (active < limit) {
        active += 1;
        resolve();
        return;
      }
      queue.push(resolve);
    });

  const release = () => {
    active -= 1;
    const next = queue.shift();
    if (next) {
      active += 1;
      next();
    }
  };

  return { acquire, release };
}

function normalizeErrorCode(value) {
  return String(value ?? 'UNKNOWN_ERROR').toUpperCase();
}

export function classifyError(error) {
  if (!error) {
    return { code: 'UNKNOWN_ERROR', retryable: false, status: 0, reason: 'empty_error' };
  }

  if (error.code && error.retryable != null) {
    return {
      code: normalizeErrorCode(error.code),
      retryable: error.retryable !== false,
      status: Number(error.status ?? 0),
      reason: error.reason ?? 'custom_error',
    };
  }

  const status = Number(error.status ?? error.response?.status ?? 0);
  const message = String(error.message ?? error.reason ?? '').toLowerCase();
  const name = String(error.name ?? '').toLowerCase();

  if (status === 429) {
    return { code: 'RATE_LIMITED', retryable: true, status, reason: 'http_429' };
  }

  if (status === 403 || status === 498) {
    return { code: 'SOURCE_BLOCKED', retryable: false, status, reason: 'http_block' };
  }

  if (status === 408 || name.includes('aborterror') || message.includes('timeout')) {
    return { code: 'TIMEOUT', retryable: true, status, reason: 'timeout' };
  }

  if (
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('enotfound') ||
    message.includes('eai_again') ||
    message.includes('network')
  ) {
    return { code: 'NETWORK_ERROR', retryable: true, status, reason: 'network' };
  }

  if (message.includes('parse') || message.includes('json') || message.includes('html')) {
    return { code: 'PARSE_ERROR', retryable: false, status, reason: 'parse' };
  }

  return {
    code: normalizeErrorCode(error.code ?? error.name ?? 'UNKNOWN_ERROR'),
    retryable: error.retryable === true ? true : false,
    status,
    reason: error.reason ?? 'unknown',
  };
}

export function createCircuitBreaker({
  threshold = 3,
  cooldownMs = 30_000,
  now = () => Date.now(),
} = {}) {
  const state = new Map();

  function getEntry(key) {
    if (!state.has(key)) {
      state.set(key, {
        failures: 0,
        openUntil: 0,
        lastError: null,
        lastSuccessAt: null,
      });
    }

    return state.get(key);
  }

  function canRun(key) {
    const entry = getEntry(key);
    return now() >= entry.openUntil;
  }

  function recordSuccess(key) {
    const entry = getEntry(key);
    entry.failures = 0;
    entry.openUntil = 0;
    entry.lastError = null;
    entry.lastSuccessAt = now();
  }

  function recordFailure(key, failure) {
    const entry = getEntry(key);
    entry.failures += 1;
    entry.lastError = failure;
    if (entry.failures >= threshold) {
      entry.openUntil = now() + cooldownMs;
    }
  }

  function snapshot(key) {
    const entry = getEntry(key);
    return {
      failures: entry.failures,
      open: now() < entry.openUntil,
      openUntil: entry.openUntil || null,
      lastError: entry.lastError,
      lastSuccessAt: entry.lastSuccessAt,
    };
  }

  return { canRun, recordSuccess, recordFailure, snapshot };
}

export function createSourceHealthTracker({ now = () => Date.now() } = {}) {
  const state = new Map();

  function getEntry(source) {
    if (!state.has(source)) {
      state.set(source, {
        successes: 0,
        failures: 0,
        lastStatus: 'unknown',
        lastErrorCode: null,
        lastSeenAt: null,
      });
    }

    return state.get(source);
  }

  function recordSuccess(source) {
    const entry = getEntry(source);
    entry.successes += 1;
    entry.lastStatus = 'healthy';
    entry.lastSeenAt = now();
    entry.lastErrorCode = null;
  }

  function recordFailure(source, failure) {
    const entry = getEntry(source);
    entry.failures += 1;
    entry.lastStatus = 'degraded';
    entry.lastSeenAt = now();
    entry.lastErrorCode = failure?.code ?? null;
  }

  function snapshot(source) {
    return { source, ...getEntry(source) };
  }

  function all() {
    return Object.fromEntries([...state.entries()].map(([source, entry]) => [source, { source, ...entry }]));
  }

  return { recordSuccess, recordFailure, snapshot, all };
}

export function createResilientExecutor({
  cacheTtlMs = 30_000,
  staleWhileRevalidateMs = 0,
  concurrency = 4,
  perSourceConcurrency = 1,
  retries = 2,
  baseDelayMs = 100,
  jitterFactor = 0.25,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  userAgents = DEFAULT_USER_AGENTS,
  breaker,
  healthTracker,
  now = () => Date.now(),
} = {}) {
  const activeBreaker = breaker ?? createCircuitBreaker({ now });
  const activeHealthTracker = healthTracker ?? createSourceHealthTracker({ now });
  const cache = new Map();
  const inFlight = new Map();
  const semaphore = createSemaphore(Math.max(1, concurrency));
  const sourceLimiters = new Map();
  let uaIndex = 0;

  function nextUserAgent() {
    const userAgent = userAgents[uaIndex % userAgents.length];
    uaIndex += 1;
    return userAgent;
  }

  function getSourceLimiter(source) {
    const key = source || 'default';
    if (!sourceLimiters.has(key)) {
      sourceLimiters.set(key, createSemaphore(Math.max(1, perSourceConcurrency)));
    }
    return sourceLimiters.get(key);
  }

  function jitterDelay(delay) {
    if (!jitterFactor) return delay;
    const min = 1 - jitterFactor;
    const max = 1 + jitterFactor;
    const factor = min + Math.random() * (max - min);
    return Math.max(0, Math.round(delay * factor));
  }

  async function withRetries(task, context) {
    let attempt = 0;
    let lastError;

    while (attempt <= retries) {
      try {
        const value = await task({
          ...context,
          attempt,
          userAgent: nextUserAgent(),
        });
        return { value, attempts: attempt + 1 };
      } catch (error) {
        const classified = classifyError(error);
        lastError = error;
        if (error && error.code == null) {
          error.code = classified.code;
        }
        if (error && error.retryable == null) {
          error.retryable = classified.retryable;
        }
        const retryable = classified.retryable;
        if (!retryable || attempt === retries) {
          break;
        }
        const delay = jitterDelay(baseDelayMs * 2 ** attempt);
        await sleep(delay);
      }
      attempt += 1;
    }

    throw lastError;
  }

  async function run(cacheKey, task, context = {}) {
    const currentTime = now();
    const source = context.source || 'default';
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > currentTime) {
      return { ok: true, value: cached.value, fromCache: true, attempts: 0 };
    }

    const existing = inFlight.get(cacheKey);
    if (existing) {
      return existing;
    }

    if (cached && cached.staleUntil > currentTime && !activeBreaker.canRun(source)) {
      return {
        ok: true,
        value: cached.value,
        fromCache: true,
        stale: true,
        attempts: 0,
      };
    }

    if (!activeBreaker.canRun(source)) {
      const failure = new Error(`circuit breaker open for ${source}`);
      failure.code = 'CIRCUIT_OPEN';
      failure.retryable = false;
      activeHealthTracker.recordFailure(source, classifyError(failure));
      return {
        ok: false,
        error: failure,
        fromCache: false,
        attempts: 0,
      };
    }

    const promise = (async () => {
      await semaphore.acquire();
      const sourceLimiter = getSourceLimiter(source);
      await sourceLimiter.acquire();
      try {
        const { value, attempts } = await withRetries(task, context);
        cache.set(cacheKey, {
          value,
          expiresAt: currentTime + cacheTtlMs,
          staleUntil: currentTime + cacheTtlMs + staleWhileRevalidateMs,
        });
        activeBreaker.recordSuccess(source);
        activeHealthTracker.recordSuccess(source);
        return { ok: true, value, fromCache: false, attempts };
      } catch (error) {
        const classified = classifyError(error);
        activeBreaker.recordFailure(source, classified);
        activeHealthTracker.recordFailure(source, classified);
        return {
          ok: false,
          error,
          fromCache: false,
          attempts: retries + 1,
        };
      } finally {
        sourceLimiter.release();
        semaphore.release();
      }
    })();

    inFlight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(cacheKey);
    }
  }

  function snapshotHealth(source) {
    return activeHealthTracker.snapshot(source);
  }

  return { run, cache, nextUserAgent, breaker: activeBreaker, healthTracker: activeHealthTracker, snapshotHealth, classifyError };
}
