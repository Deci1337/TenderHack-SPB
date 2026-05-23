import { scoreOffer } from './lib/query.js';
import { fetchAndParseOffers, fetchAndParseOzonOffers } from './lib/product-pages.js';
import { fetchWildberriesOffers } from './lib/wildberries-api.js';
import { fetchOldiOffers } from './lib/oldi.js';
import { scrapeWildberriesStealth, scrapeOzonStealth, scrapeYandexMarketStealth } from './lib/stealth-scraper.js';
import { resolveGeo } from './lib/geo.js';

const wbItems = [
  {
    title: 'Apple iPhone 15 128GB Black',
    price: 79990,
    image_url: 'https://example.com/wb-iphone15.jpg',
    product_url: 'https://wildberries.ru/catalog/iphone-15',
    features: ['128 GB', 'Black', 'OLED'],
    currency: 'RUB',
    availability: 'in_stock',
  },
  {
    title: 'Samsung Galaxy S24 256GB',
    price: 92990,
    image_url: 'https://example.com/wb-s24.jpg',
    product_url: 'https://wildberries.ru/catalog/galaxy-s24',
    features: ['256 GB', 'Silver'],
    currency: 'RUB',
    availability: 'in_stock',
  },
  {
    title: 'Kitchen Blender Pro 1200W',
    price: 6990,
    image_url: 'https://example.com/wb-blender.jpg',
    product_url: 'https://wildberries.ru/catalog/blender',
    features: ['1200W', '5 speeds'],
    currency: 'RUB',
    availability: 'in_stock',
  },
];

const ozonItems = [
  {
    title: 'iPhone 15 128 GB Apple',
    price: 80990,
    image_url: 'https://example.com/ozon-iphone15.jpg',
    product_url: 'https://ozon.ru/product/iphone-15',
    features: ['128 GB', 'Black'],
    currency: 'RUB',
    availability: 'in_stock',
  },
  {
    title: 'Samsung Galaxy S24 256 GB',
    price: 91990,
    image_url: 'https://example.com/ozon-s24.jpg',
    product_url: 'https://ozon.ru/product/galaxy-s24',
    features: ['256 GB', 'Silver'],
    currency: 'RUB',
    availability: 'in_stock',
  },
  {
    title: 'Hand Blender 1200W Kitchen',
    price: 6490,
    image_url: 'https://example.com/ozon-blender.jpg',
    product_url: 'https://ozon.ru/product/blender',
    features: ['1200W', '5 speeds'],
    currency: 'RUB',
    availability: 'in_stock',
  },
];

const yandexItems = [
  {
    title: 'Apple iPhone 15 128GB смартфон',
    price: 78990,
    image_url: 'https://example.com/ym-iphone15.jpg',
    product_url: 'https://market.yandex.ru/product/iphone-15',
    features: ['128 GB', 'Black', 'A16'],
    currency: 'RUB',
    availability: 'in_stock',
  },
  {
    title: 'Samsung Galaxy S24 смартфон 256GB',
    price: 93990,
    image_url: 'https://example.com/ym-s24.jpg',
    product_url: 'https://market.yandex.ru/product/galaxy-s24',
    features: ['256 GB', 'Silver', 'AMOLED'],
    currency: 'RUB',
    availability: 'in_stock',
  },
  {
    title: 'Blender 1200W for Kitchen',
    price: 7190,
    image_url: 'https://example.com/ym-blender.jpg',
    product_url: 'https://market.yandex.ru/product/blender',
    features: ['1200W', 'Stainless steel'],
    currency: 'RUB',
    availability: 'in_stock',
  },
];

const runetItems = [
  {
    title: 'Apple iPhone 15 128 GB',
    price: 79590,
    image_url: 'https://example.com/runet-iphone15.jpg',
    product_url: 'https://runet.example/iphone-15',
    features: ['128 GB', 'Black'],
    currency: 'RUB',
    availability: 'in_stock',
  },
  {
    title: 'Kitchen Blender Pro 1200W',
    price: 6790,
    image_url: 'https://example.com/runet-blender.jpg',
    product_url: 'https://runet.example/blender',
    features: ['1200W', '5 speeds'],
    currency: 'RUB',
    availability: 'in_stock',
  },
];

function toOffer(source, item, normalizedQuery, retrievalMode = 'fallback', sourceUrl = item.product_url) {
  const relevance_score = scoreOffer(normalizedQuery.tokens, item);
  return {
    source,
    title: item.title,
    price: item.price,
    image_url: item.image_url,
    product_url: item.product_url,
    features: item.features ?? [],
    currency: item.currency ?? 'RUB',
    availability: item.availability ?? 'unknown',
    matched_query: normalizedQuery.original,
    normalized_query: normalizedQuery.normalized,
    relevance_score,
    fetched_at: new Date().toISOString(),
    raw_payload: {
      ...item,
      retrieval_mode: retrievalMode,
      source_url: sourceUrl,
    },
  };
}

function createFallbackAdapter(source, items) {
  return {
    name: source,
    async search(normalizedQuery) {
      return items
        .map((item) => toOffer(source, item, normalizedQuery))
        .filter((offer) => offer.relevance_score >= 20)
        .sort((a, b) => b.relevance_score - a.relevance_score || a.price - b.price);
    },
  };
}


function createOzonAdapter({
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  playwrightTimeoutMs = process.env.PLAYWRIGHT_TIMEOUT ? Number(process.env.PLAYWRIGHT_TIMEOUT) : 90000,
  usePlaywright = process.env.USE_PLAYWRIGHT !== '0',
  geo = null,
} = {}) {
  const fallbackAdapter = createFallbackAdapter('ozon', ozonItems);

  return {
    name: 'ozon',
    async search(normalizedQuery) {
      // Try stealth-browser first (passes antibot on residential IPs)
      if (usePlaywright) {
        const pwResult = await scrapeOzonStealth({
          normalizedQuery,
          limit: 20,
          timeoutMs: playwrightTimeoutMs,
          enrichSpecs: true,
          geo,
        }).catch(() => ({ offers: [], attempts: [], liveHit: false }));

        if (pwResult.liveHit && pwResult.offers.length > 0) {
          return pwResult.offers;
        }
      }

      // Fallback: try Ozon composer-API via HTTP
      const liveResult = await fetchAndParseOzonOffers({
        normalizedQuery,
        fetchImpl,
        timeoutMs,
      });

      if (liveResult.liveHit && liveResult.offers.length > 0) {
        return liveResult.offers;
      }

      const fallbackOffers = await fallbackAdapter.search(normalizedQuery);
      if (fallbackOffers.length === 0) {
        return [];
      }

      const fallbackReason = liveResult.attempts.length > 0
        ? `ozon api blocked or empty after ${liveResult.attempts.length} attempts`
        : 'ozon api not attempted';

      return fallbackOffers.map((offer) => ({
        ...offer,
        raw_payload: {
          ...offer.raw_payload,
          fallback_reason: fallbackReason,
          live_attempts: liveResult.attempts,
        },
      }));
    },
  };
}

function createWildberriesAdapter({
  fetchImpl = globalThis.fetch,
  wbApiToken = process.env.WB_X_WBAAS_TOKEN,
  wbCookie = process.env.WB_COOKIE,
  wbPow = process.env.WB_X_POW,
  timeoutMs = 15000,
  limit = 24,
  internalFallback = process.env.WB_INTERNAL_FALLBACK !== '0',
  internalMaxPages = 3,
  internalMaxRanges = 6,
  playwrightTimeoutMs = process.env.PLAYWRIGHT_TIMEOUT ? Number(process.env.PLAYWRIGHT_TIMEOUT) : 90000,
  usePlaywright = process.env.USE_PLAYWRIGHT !== '0',
  geo = null,
} = {}) {
  const fallbackAdapter = createFallbackAdapter('wildberries', wbItems);

  return {
    name: 'wildberries',
    async search(normalizedQuery) {
      // Try stealth-browser first — it passes WB antibot challenge on residential IPs
      if (usePlaywright) {
        const pwResult = await scrapeWildberriesStealth({
          normalizedQuery,
          limit,
          timeoutMs: playwrightTimeoutMs,
          enrichSpecs: true,
          geo,
        }).catch(() => ({ offers: [], attempts: [], liveHit: false }));

        if (pwResult.liveHit && pwResult.offers.length > 0) {
          return pwResult.offers;
        }
      }

      // Fallback: official WB JSON API (requires WB_X_WBAAS_TOKEN env var)
      const liveResult = await fetchWildberriesOffers({
        source: 'wildberries',
        normalizedQuery,
        fetchImpl,
        token: wbApiToken,
        cookie: wbCookie,
        pow: wbPow,
        timeoutMs,
        limit,
        internalFallback,
        internalMaxPages,
        internalMaxRanges,
        dest: geo?.wbDest,
      });

      if (liveResult.liveHit && liveResult.offers.length > 0) {
        return liveResult.offers;
      }

      const fallbackOffers = await fallbackAdapter.search(normalizedQuery);
      if (fallbackOffers.length === 0) {
        return [];
      }

      const fallbackReason = liveResult.attempts.length > 0
        ? `wb api blocked or empty after ${liveResult.attempts.length} attempts`
        : 'wb api not attempted';

      return fallbackOffers.map((offer) => ({
        ...offer,
        raw_payload: {
          ...offer.raw_payload,
          fallback_reason: fallbackReason,
          live_attempts: liveResult.attempts,
        },
      }));
    },
  };
}

function createOldiAdapter({
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  limit = 10,
} = {}) {
  const fallbackAdapter = createFallbackAdapter('oldi', runetItems);

  return {
    name: 'oldi',
    async search(normalizedQuery) {
      const liveResult = await fetchOldiOffers({
        normalizedQuery,
        fetchImpl,
        limit,
        timeoutMs,
      });

      if (liveResult.liveHit && liveResult.offers.length > 0) {
        return liveResult.offers;
      }

      const fallbackOffers = await fallbackAdapter.search(normalizedQuery);
      if (fallbackOffers.length === 0) {
        return [];
      }

      const fallbackReason = liveResult.attempts.length > 0
        ? `oldi blocked or empty after ${liveResult.attempts.length} attempts`
        : 'oldi not attempted';

      return fallbackOffers.map((offer) => ({
        ...offer,
        raw_payload: {
          ...offer.raw_payload,
          fallback_reason: fallbackReason,
          live_attempts: liveResult.attempts,
        },
      }));
    },
  };
}

function createYandexMarketAdapter({
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  playwrightTimeoutMs = process.env.PLAYWRIGHT_TIMEOUT ? Number(process.env.PLAYWRIGHT_TIMEOUT) : 90000,
  usePlaywright = process.env.USE_PLAYWRIGHT !== '0',
  geo = null,
} = {}) {
  const fallbackAdapter = createFallbackAdapter('yandex_market', yandexItems);

  return {
    name: 'yandex_market',
    async search(normalizedQuery) {
      // Try stealth-browser first
      if (usePlaywright) {
        const pwResult = await scrapeYandexMarketStealth({
          normalizedQuery,
          limit: 20,
          timeoutMs: playwrightTimeoutMs,
          enrichSpecs: true,
          geo,
        }).catch(() => ({ offers: [], attempts: [], liveHit: false }));

        if (pwResult.liveHit && pwResult.offers.length > 0) {
          return pwResult.offers;
        }
      }

      // HTTP fallback
      const lr = geo?.ymLr;
      const ymUrl = `https://market.yandex.ru/search?text=${encodeURIComponent(normalizedQuery.normalized)}`
        + (lr ? `&lr=${encodeURIComponent(lr)}&rgn=${encodeURIComponent(lr)}` : '');
      const liveResult = await fetchAndParseOffers({
        source: 'yandex_market',
        normalizedQuery,
        urls: [ymUrl],
        fetchImpl,
        timeoutMs,
      });

      if (liveResult.liveHit && liveResult.offers.length > 0) {
        return liveResult.offers;
      }

      const fallbackOffers = await fallbackAdapter.search(normalizedQuery);
      if (fallbackOffers.length === 0) return [];

      const fallbackReason = liveResult.attempts.length > 0
        ? `yandex market blocked or empty after ${liveResult.attempts.length} attempts`
        : 'yandex market not attempted';

      return fallbackOffers.map((offer) => ({
        ...offer,
        raw_payload: { ...offer.raw_payload, fallback_reason: fallbackReason, live_attempts: liveResult.attempts },
      }));
    },
  };
}

export function buildAdapters({
  fetchImpl = globalThis.fetch,
  wbApiToken = process.env.WB_X_WBAAS_TOKEN,
  wbCookie = process.env.WB_COOKIE,
  wbPow = process.env.WB_X_POW,
  sourcePolicies = {},
  city,
  geo: geoOverride,
} = {}) {
  const wildberriesPolicy = sourcePolicies.wildberries ?? {};
  const ozonPolicy = sourcePolicies.ozon ?? {};
  const yandexMarketPolicy = sourcePolicies.yandex_market ?? {};
  const oldiPolicy = sourcePolicies.oldi ?? {};

  // Регион можно задать именем (city) или сырыми кодами (geo). Явные коды имеют приоритет.
  const geo = resolveGeo({ city, ...(geoOverride ?? {}) });

  return [
    createWildberriesAdapter({
      fetchImpl,
      wbApiToken,
      wbCookie,
      wbPow,
      timeoutMs: wildberriesPolicy.timeoutMs,
      limit: wildberriesPolicy.limit,
      internalFallback: wildberriesPolicy.internalFallback,
      internalMaxPages: wildberriesPolicy.internalMaxPages,
      internalMaxRanges: wildberriesPolicy.internalMaxRanges,
      geo,
    }),
    createOzonAdapter({
      fetchImpl,
      timeoutMs: ozonPolicy.timeoutMs,
      geo,
    }),
    createYandexMarketAdapter({
      fetchImpl,
      timeoutMs: yandexMarketPolicy.timeoutMs,
      geo,
    }),
    createOldiAdapter({
      fetchImpl,
      timeoutMs: oldiPolicy.timeoutMs,
      limit: oldiPolicy.limit,
    }),
  ];
}
