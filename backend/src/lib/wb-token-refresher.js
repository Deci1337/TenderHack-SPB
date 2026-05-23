function defaultLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

export function createWbTokenRefresher({
  resolveToken,
  refreshMs = 5 * 60 * 1000,
  jitterMs = 15 * 1000,
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  logger = defaultLogger(),
} = {}) {
  if (typeof resolveToken !== 'function') {
    throw new TypeError('resolveToken must be a function');
  }

  let timer = null;
  let running = false;
  let inFlight = false;
  const state = {
    token: null,
    cookie: null,
    pow: null,
    updatedAt: null,
    lastError: null,
    refreshCount: 0,
  };

  function scheduleNext() {
    if (!running) return;
    const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
    timer = setTimeoutFn(() => {
      void refresh();
    }, refreshMs + jitter);
  }

  async function refresh() {
    if (!running || inFlight) return;
    inFlight = true;
    try {
      const envelope = await resolveToken();
      if (!envelope?.token) {
        throw new Error('Token resolver returned empty token');
      }
      state.token = envelope.token;
      state.cookie = envelope.cookie ?? `x_wbaas_token=${envelope.token}`;
      state.pow = envelope.pow ?? null;
      state.updatedAt = new Date(now()).toISOString();
      state.lastError = null;
      state.refreshCount += 1;
      logger.info(`WB token refreshed (${state.refreshCount})`);
    } catch (error) {
      state.lastError = error?.message ?? String(error);
      logger.warn(`WB token refresh failed: ${state.lastError}`);
    } finally {
      inFlight = false;
      scheduleNext();
    }
  }

  function start() {
    if (running) return;
    running = true;
    void refresh();
  }

  function stop() {
    running = false;
    if (timer) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  function getState() {
    return { ...state };
  }

  return {
    start,
    stop,
    refresh,
    getState,
  };
}
