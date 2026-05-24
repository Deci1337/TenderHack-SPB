import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonLdProducts, extractNextDataProducts, extractOzonProducts, fetchAndParseOffers, isBlockedResponse } from '../src/lib/product-pages.js';
import { buildAdapters } from '../src/catalog.js';
import { normalizeQuery } from '../src/lib/query.js';

const sampleHtml = `
<html>
  <head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "item": {
            "@type": "Product",
            "name": "Demo Phone",
            "image": "https://example.com/demo.jpg",
            "url": "https://example.com/demo",
            "additionalProperty": [{"name":"color","value":"black"}],
            "offers": {
              "@type": "Offer",
              "price": "12345",
              "priceCurrency": "RUB",
              "availability": "https://schema.org/InStock"
            }
          }
        }
      ]
    }
    </script>
  </head>
</html>`;

const nextDataHtml = `
<html>
  <head>
    <script id="__NEXT_DATA__" type="application/json">
    {
      "props": {
        "pageProps": {
          "product": {
            "title": "Next Phone",
            "image": "https://example.com/next.jpg",
            "url": "https://example.com/next",
            "price": 22222,
            "offers": {
              "price": 22222,
              "priceCurrency": "RUB"
            }
          }
        }
      }
    }
    </script>
  </head>
</html>`;

const ozonComposerJson = {
  catalog: {
    catalogResultsHeader: {
      'catalogResultsHeader-301290-default-1': {
        header: 'Телевизоры',
        totalFound: '1 432 товара',
        cellTrackingInfo: {
          type: 'ui',
          title: 'Телевизоры',
          countItems: 1,
          searchString: '',
          elementType: 'header',
        },
      },
    },
    searchResultsV2: {
      'searchResultsV2-192247-default-1': {
        items: [
          {
            cellTrackingInfo: {
              index: 1,
              id: 184286696,
              title: 'HD Телевизор Xiaomi Mi TV 4A 32", черный',
              availability: 1,
              price: 11990,
              finalPrice: 11990,
              deliverySchema: 'Retail',
              category: 'Электроника/Телевизоры и видеотехника/Телевизоры/Xiaomi',
              brand: 'Xiaomi',
            },
          },
        ],
      },
    },
  },
};

test('extractJsonLdProducts parses product listings from HTML', () => {
  const products = extractJsonLdProducts(sampleHtml);
  assert.equal(products.length, 1);
  assert.equal(products[0].name, 'Demo Phone');
});

test('isBlockedResponse detects common blocking signals', () => {
  assert.equal(isBlockedResponse(403, '<html></html>'), true);
  assert.equal(isBlockedResponse(200, '<html><body>Похоже, вы используете VPN</body></html>'), true);
  assert.equal(isBlockedResponse(200, '<html><body>ok</body></html>'), false);
});

test('extractNextDataProducts parses product data from Next.js payloads', () => {
  const products = extractNextDataProducts(nextDataHtml);
  assert.equal(products.length, 1);
  assert.equal(products[0].title, 'Next Phone');
});

test('extractOzonProducts parses composer JSON search results from Ozon', () => {
  const products = extractOzonProducts(ozonComposerJson, 'https://api.ozon.ru/composer-api.bx/page/json/v1?url=/search/?text=%D1%82%D0%B5%D0%BB%D0%B5%D0%B2%D0%B8%D0%B7%D0%BE%D1%80%D1%8B');
  assert.equal(products.length, 1);
  assert.equal(products[0].title, 'HD Телевизор Xiaomi Mi TV 4A 32", черный');
  assert.equal(products[0].price, 11990);
  assert.equal(products[0].raw_payload.id, 184286696);
});

test('live adapters use parsed JSON when available', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    url: 'https://example.com/live',
    text: async () => JSON.stringify(ozonComposerJson),
  });

  const ozon = buildAdapters({ fetchImpl }).find((adapter) => adapter.name === 'ozon');
  const result = await ozon.search(normalizeQuery('iphone 15'));

  assert.equal(result[0].title, 'HD Телевизор Xiaomi Mi TV 4A 32", черный');
  assert.equal(result[0].raw_payload.retrieval_mode, 'live_ozon_api');
});

test('live adapters fall back to fixtures when blocked', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    url: 'https://blocked.example',
    text: async () => JSON.stringify({
      incidentId: 'fab_chlg_1',
      challengeURL: 'https://api.ozon.ru/challenge.html?challenge=test',
    }),
  });

  const [wildberries] = buildAdapters({ fetchImpl, wbApiToken: 'test-token' });
  const result = await wildberries.search(normalizeQuery('iphone 15'));

  assert.ok(result.some((offer) => offer.title.includes('iPhone 15')));
  assert.equal(result[0].raw_payload.retrieval_mode, 'fallback');
});

test('ozon adapter falls back on 429 rate limiting', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    url: 'https://api.ozon.ru/composer-api.bx/page/json/v1?url=/search/?text=iphone',
    text: async () => JSON.stringify({
      incidentId: 'rate_limited',
      challengeURL: 'https://api.ozon.ru/challenge.html',
    }),
  });

  const ozon = buildAdapters({ fetchImpl }).find((adapter) => adapter.name === 'ozon');
  const result = await ozon.search(normalizeQuery('iphone 15'));

  assert.ok(result.length > 0);
  assert.equal(result[0].raw_payload.retrieval_mode, 'fallback');
  assert.equal(result[0].raw_payload.live_attempts[0].status, 429);
});

test('ozon adapter falls back on schema drift', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    url: 'https://api.ozon.ru/composer-api.bx/page/json/v1?url=/search/?text=iphone',
    text: async () => JSON.stringify({
      catalog: {
        searchResultsV2: {
          broken: {
            items: [
              {
                cellTrackingInfo: {
                  title: 'Broken product without price',
                },
              },
            ],
          },
        },
      },
    }),
  });

  const ozon = buildAdapters({ fetchImpl }).find((adapter) => adapter.name === 'ozon');
  const result = await ozon.search(normalizeQuery('iphone 15'));

  assert.ok(result.length > 0);
  assert.equal(result[0].raw_payload.retrieval_mode, 'fallback');
});

test('live adapters fall back to fixtures when HTML is empty or unparsable', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    url: 'https://example.com/empty',
    text: async () => JSON.stringify({ catalog: {} }),
  });

  const ozon = buildAdapters({ fetchImpl }).find((adapter) => adapter.name === 'ozon');
  const result = await ozon.search(normalizeQuery('iphone 15'));

  assert.ok(result.length > 0);
  assert.equal(result[0].raw_payload.retrieval_mode, 'fallback');
  assert.equal(Array.isArray(result[0].raw_payload.live_attempts), true);
  assert.equal(result[0].raw_payload.live_attempts[0].status, 200);
});

test('fetchAndParseOffers records network errors as blocked attempts', async () => {
  const result = await fetchAndParseOffers({
    source: 'wildberries',
    normalizedQuery: normalizeQuery('iphone 15'),
    urls: ['https://example.com/error'],
    fetchImpl: async () => {
      const error = new TypeError('fetch failed');
      error.cause = new Error('redirect count exceeded');
      throw error;
    },
  });

  assert.equal(result.liveHit, false);
  assert.equal(result.offers.length, 0);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].status, 0);
  assert.equal(result.attempts[0].blocked, true);
  assert.equal(result.attempts[0].error_name, 'TypeError');
  assert.equal(result.attempts[0].error_message, 'fetch failed');
  assert.equal(result.attempts[0].error_cause, 'redirect count exceeded');
});

test('fetchAndParseOffers records timeout attempts', async () => {
  const result = await fetchAndParseOffers({
    source: 'yandex_market',
    normalizedQuery: normalizeQuery('iphone 15'),
    urls: ['https://example.com/timeout'],
    fetchImpl: async () => {
      const error = new Error('timeout');
      error.name = 'AbortError';
      throw error;
    },
  });

  assert.equal(result.liveHit, false);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].error_name, 'AbortError');
  assert.equal(result.attempts[0].blocked, true);
});

test('live adapters fall back when composer JSON has no search results', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    url: 'https://example.com/next',
    text: async () => JSON.stringify({ catalog: { searchResultsV2: {} } }),
  });

  const ozon = buildAdapters({ fetchImpl }).find((adapter) => adapter.name === 'ozon');
  const result = await ozon.search(normalizeQuery('iphone 15'));

  assert.ok(result.length > 0);
  assert.equal(result[0].raw_payload.retrieval_mode, 'fallback');
});
