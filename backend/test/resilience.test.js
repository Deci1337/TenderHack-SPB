import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, createCircuitBreaker, createResilientExecutor } from '../src/lib/resilience.js';
import { createSearchService } from '../src/pipeline.js';

test('createResilientExecutor retries once and then succeeds', async () => {
  const delays = [];
  let attempts = 0;
  const executor = createResilientExecutor({
    retries: 1,
    baseDelayMs: 10,
    jitterFactor: 0,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  const outcome = await executor.run('key', async ({ attempt, userAgent }) => {
    attempts += 1;
    if (attempt === 0) {
      const error = new Error(`blocked with ${userAgent}`);
      error.retryable = true;
      throw error;
    }
    return ['ok'];
  });

  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.value, ['ok']);
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [10]);
});

test('searchProducts returns partial results when one adapter fails', async () => {
  const service = createSearchService({
    adapters: [
      {
        name: 'good',
        search: async () => [
          {
            source: 'good',
            title: 'Apple iPhone 15 128GB',
            price: 100,
            image_url: '',
            product_url: 'https://example.com/good',
            features: [],
            currency: 'RUB',
            availability: 'in_stock',
            matched_query: 'iphone 15',
            normalized_query: 'iphone 15',
            relevance_score: 90,
            fetched_at: '2026-01-01T00:00:00.000Z',
            raw_payload: {},
          },
        ],
      },
      {
        name: 'bad',
        search: async () => {
          const error = new Error('blocked');
          error.retryable = false;
          throw error;
        },
      },
    ],
    executor: createResilientExecutor({ retries: 0 }),
    now: () => '2026-05-16T00:00:00.000Z',
  });

  const result = await service.searchProducts('iphone 15');
  assert.equal(result.offers.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].source, 'bad');
  assert.equal(result.source_counts.good, 1);
  assert.equal(result.source_counts.bad, 0);
});

test('searchProducts exposes execution log and cache hits', async () => {
  let calls = 0;
  const service = createSearchService({
    adapters: [
      {
        name: 'cached',
        search: async () => {
          calls += 1;
          return [
            {
              source: 'cached',
              title: 'Apple iPhone 15 128GB',
              price: 100,
              image_url: '',
              product_url: 'https://example.com/cached',
              features: [],
              currency: 'RUB',
              availability: 'in_stock',
              matched_query: 'iphone 15',
              normalized_query: 'iphone 15',
              relevance_score: 90,
              fetched_at: '2026-01-01T00:00:00.000Z',
              raw_payload: {},
            },
          ];
        },
      },
    ],
    executor: createResilientExecutor({ retries: 0 }),
    now: () => '2026-05-16T00:00:00.000Z',
  });

  const first = await service.searchProducts('iphone 15');
  const second = await service.searchProducts('iphone 15');

  assert.equal(calls, 1);
  assert.equal(first.execution_log[0].cache_hit, false);
  assert.equal(second.execution_log[0].cache_hit, true);
  assert.equal(second.execution_log[0].attempts, 0);
});

test('classifyError maps block and timeout failures', async () => {
  assert.deepEqual(classifyError(Object.assign(new Error('nope'), { status: 403 })), {
    code: 'SOURCE_BLOCKED',
    retryable: false,
    status: 403,
    reason: 'http_block',
  });

  assert.deepEqual(classifyError(Object.assign(new Error('request timeout'), { name: 'AbortError' })), {
    code: 'TIMEOUT',
    retryable: true,
    status: 0,
    reason: 'timeout',
  });
});

test('createResilientExecutor dedupes concurrent in-flight requests', async () => {
  let calls = 0;
  let resolveTask;
  const taskPromise = new Promise((resolve) => {
    resolveTask = resolve;
  });

  const executor = createResilientExecutor({
    retries: 0,
    concurrency: 2,
    perSourceConcurrency: 2,
  });

  const first = executor.run('dedupe-key', async () => {
    calls += 1;
    return taskPromise;
  }, { source: 'source-a' });

  const second = executor.run('dedupe-key', async () => {
    calls += 1;
    return 'unexpected';
  }, { source: 'source-a' });

  resolveTask(['ok']);
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.deepEqual(firstResult.value, ['ok']);
  assert.deepEqual(secondResult.value, ['ok']);
});

test('createResilientExecutor opens a circuit breaker after repeated failures', async () => {
  let now = 0;
  let calls = 0;
  const breaker = createCircuitBreaker({
    threshold: 2,
    cooldownMs: 1000,
    now: () => now,
  });
  const executor = createResilientExecutor({
    retries: 0,
    breaker,
    now: () => now,
  });

  const failTask = async () => {
    calls += 1;
    const error = new Error('blocked');
    error.status = 403;
    throw error;
  };

  const first = await executor.run('breaker-key', failTask, { source: 'source-b' });
  const second = await executor.run('breaker-key-2', failTask, { source: 'source-b' });
  const third = await executor.run('breaker-key-3', failTask, { source: 'source-b' });

  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(third.ok, false);
  assert.equal(calls, 2);
  assert.equal(third.error.code, 'CIRCUIT_OPEN');
});
