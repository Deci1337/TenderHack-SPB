import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWildberriesOffers } from '../src/lib/wildberries-api.js';
import { normalizeQuery } from '../src/lib/query.js';
import { buildAdapters } from '../src/catalog.js';

test('fetchWildberriesOffers returns explicit blocker when auth token is missing', async () => {
  const result = await fetchWildberriesOffers({
    normalizedQuery: normalizeQuery('iphone 15'),
    fetchImpl: async () => {
      throw new Error('must not call network');
    },
    token: '',
    pow: '',
  });

  assert.equal(result.liveHit, false);
  assert.equal(result.offers.length, 0);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].step, 'auth');
  assert.equal(result.attempts[0].error_message, 'Missing WB_X_WBAAS_TOKEN/WB_X_POW and no valid token from WB_AUTH_PROVIDER_URL');
});

test('fetchWildberriesOffers parses official search and cards API payloads', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/webapi/search/data')) {
      return {
        ok: true,
        status: 200,
        url,
        headers: new Headers(),
        text: async () => JSON.stringify({
          data: {
            products: [
              { id: 111111, name: 'WB Search Phone', salePriceU: 1234500 },
            ],
          },
        }),
      };
    }

    if (url.includes('/cards/v1/detail')) {
      return {
        ok: true,
        status: 200,
        url,
        headers: new Headers(),
        text: async () => JSON.stringify({
          data: {
            products: [
              {
                id: 111111,
                name: 'WB Card Phone',
                brand: 'Apple',
                salePriceU: 1234500,
              },
            ],
          },
        }),
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await fetchWildberriesOffers({
    normalizedQuery: normalizeQuery('wb card phone'),
    fetchImpl,
    token: 'test-token',
  });

  assert.equal(result.liveHit, true);
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].title, 'WB Card Phone');
  assert.equal(result.offers[0].price, 12345);
  assert.equal(result.offers[0].raw_payload.retrieval_mode, 'live_wb_api');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].step, 'search_api');
  assert.equal(result.attempts[1].step, 'cards_api');
});

test('fetchWildberriesOffers can auto-load auth from provider endpoint', async () => {
  const fetchImpl = async (url) => {
    if (url === 'https://auth.local/wb-token') {
      return {
        ok: true,
        status: 200,
        url,
        headers: new Headers(),
        text: async () => JSON.stringify({ token: 'provider-token' }),
      };
    }

    if (url.includes('/webapi/search/data')) {
      return {
        ok: true,
        status: 200,
        url,
        headers: new Headers(),
        text: async () => JSON.stringify({
          data: {
            products: [{ id: 222222, name: 'WB Provider Search', salePriceU: 999900 }],
          },
        }),
      };
    }

    if (url.includes('/cards/v1/detail')) {
      return {
        ok: true,
        status: 200,
        url,
        headers: new Headers(),
        text: async () => JSON.stringify({
          data: {
            products: [{ id: 222222, name: 'WB Provider Card', salePriceU: 999900 }],
          },
        }),
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await fetchWildberriesOffers({
    normalizedQuery: normalizeQuery('provider card'),
    fetchImpl,
    token: '',
    pow: '',
    authProviderUrl: 'https://auth.local/wb-token',
  });

  assert.equal(result.liveHit, true);
  assert.equal(result.offers[0].title, 'WB Provider Card');
  assert.equal(result.attempts[0].step, 'auth_provider');
  assert.equal(result.attempts[1].step, 'search_api');
  assert.equal(result.attempts[2].step, 'cards_api');
});

test('wildberries adapter keeps fallback stable when official API is blocked', async () => {
  const [wildberries] = buildAdapters({
    fetchImpl: async () => ({
      ok: false,
      status: 498,
      url: 'https://www.wildberries.ru/webapi/search/data?query=iphone',
      headers: new Headers([['x-wbaas-token', 'get']]),
      text: async () => 'challenge is required',
    }),
    wbApiToken: 'test-token',
  });

  const result = await wildberries.search(normalizeQuery('iphone 15'));
  assert.ok(result.length > 0);
  assert.equal(result[0].raw_payload.retrieval_mode, 'fallback');
  assert.equal(Array.isArray(result[0].raw_payload.live_attempts), true);
  assert.equal(result[0].raw_payload.live_attempts[0].status, 498);
});

test('fetchWildberriesOffers falls back to internal catalog endpoint when cards API is blocked', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/webapi/search/data')) {
      return {
        ok: true,
        status: 200,
        url,
        headers: new Headers(),
        text: async () => JSON.stringify({
          data: {
            products: [{ id: 333333, name: 'WB Search Seed', salePriceU: 1500000 }],
          },
        }),
      };
    }

    if (url.includes('/cards/v1/detail')) {
      return {
        ok: false,
        status: 404,
        url,
        headers: new Headers([['x-pow', 'status=invalid;challenge=abc']]),
        text: async () => '',
      };
    }

    if (url.includes('/__internal/u-search/exactmatch') && url.includes('resultset=filters')) {
      return {
        ok: true,
        status: 200,
        url,
        headers: new Headers(),
        text: async () => JSON.stringify({
          data: {
            filters: [{ name: 'Цена', minPriceU: 100000, maxPriceU: 200000 }],
          },
        }),
      };
    }

    if (url.includes('/__internal/u-search/exactmatch') && url.includes('resultset=catalog')) {
      return {
        ok: true,
        status: 200,
        url,
        headers: new Headers(),
        text: async () => JSON.stringify({
          data: {
            total: 1,
            products: [{ id: 444444, name: 'WB Internal Product', salePriceU: 777700 }],
          },
        }),
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await fetchWildberriesOffers({
    normalizedQuery: normalizeQuery('internal wb'),
    fetchImpl,
    token: 'test-token',
    internalMaxPages: 1,
    internalMaxRanges: 1,
  });

  assert.equal(result.liveHit, true);
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].title, 'WB Internal Product');
  assert.equal(result.offers[0].raw_payload.retrieval_mode, 'live_wb_internal_api');
  assert.ok(result.attempts.some((attempt) => attempt.step === 'internal_filters'));
  assert.ok(result.attempts.some((attempt) => attempt.step === 'internal_catalog'));
});

test('fetchWildberriesOffers falls back on schema drift in search payload', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/webapi/search/data')) {
      return {
        ok: true,
        status: 200,
        url,
        headers: new Headers(),
        text: async () => JSON.stringify({
          data: {
            items: [{ id: 555555, name: 'WB Drift Product' }],
          },
        }),
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await fetchWildberriesOffers({
    normalizedQuery: normalizeQuery('drift wb'),
    fetchImpl,
    token: 'test-token',
    internalFallback: false,
  });

  assert.equal(result.liveHit, false);
  assert.equal(result.offers.length, 0);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].step, 'search_api');
});

test('fetchWildberriesOffers records timeout attempts as blocked and non-fatal', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/webapi/search/data')) {
      const error = new Error('timeout');
      error.name = 'AbortError';
      throw error;
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await fetchWildberriesOffers({
    normalizedQuery: normalizeQuery('timeout wb'),
    fetchImpl,
    token: 'test-token',
    internalFallback: false,
  });

  assert.equal(result.liveHit, false);
  assert.equal(result.offers.length, 0);
  assert.equal(result.attempts[0].step, 'search_api');
  assert.equal(result.attempts[0].error_name, 'AbortError');
});
