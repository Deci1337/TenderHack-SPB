import { fetchAndParseOffers, fetchAndParseOzonOffers } from './lib/product-pages.js';
import { fetchWildberriesOffers } from './lib/wildberries-api.js';
import { scrapeWildberriesStealth, scrapeOzonStealth, scrapeYandexMarketStealth } from './lib/stealth-scraper.js';
import { resolveGeo } from './lib/geo.js';



function createOzonAdapter({
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  playwrightTimeoutMs = process.env.PLAYWRIGHT_TIMEOUT ? Number(process.env.PLAYWRIGHT_TIMEOUT) : 90000,
  usePlaywright = process.env.USE_PLAYWRIGHT !== '0',
  geo = null,
} = {}) {
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

      return [];
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

      return [];
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

      return [];
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
  ];
}
