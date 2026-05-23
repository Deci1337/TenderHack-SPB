import test from 'node:test';
import assert from 'node:assert/strict';
import { createWbTokenRefresher } from '../src/lib/wb-token-refresher.js';

test('wb token refresher updates state and schedules next refresh', async () => {
  const timers = [];
  const refresher = createWbTokenRefresher({
    resolveToken: async () => ({ token: 't1', cookie: 'x_wbaas_token=t1' }),
    refreshMs: 1000,
    jitterMs: 0,
    setTimeoutFn: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeoutFn: () => {},
  });

  refresher.start();
  await new Promise((resolve) => setImmediate(resolve));

  const state = refresher.getState();
  assert.equal(state.token, 't1');
  assert.equal(state.refreshCount, 1);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 1000);
  refresher.stop();
});

test('wb token refresher stores last error on failed refresh', async () => {
  const refresher = createWbTokenRefresher({
    resolveToken: async () => {
      throw new Error('network down');
    },
    refreshMs: 1000,
    jitterMs: 0,
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
  });

  refresher.start();
  await new Promise((resolve) => setImmediate(resolve));

  const state = refresher.getState();
  assert.equal(state.token, null);
  assert.equal(state.lastError, 'network down');
  refresher.stop();
});
