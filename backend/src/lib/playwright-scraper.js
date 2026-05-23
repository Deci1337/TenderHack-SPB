import { chromium } from 'playwright';
import { scoreOffer } from './query.js';

const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function parsePrice(raw) {
  if (raw == null) return NaN;
  const n = Number(String(raw).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

function normalizePrice(value) {
  // WB API (v9/v18) всегда отдаёт цену в копейках в sizes[].price.product, salePriceU, priceU.
  // Делим на 100 безусловно — иначе товары дешевле 100₽ показывались бы x100.
  const p = parsePrice(value);
  if (!Number.isFinite(p)) return NaN;
  return Math.round(p / 100);
}

async function launchBrowser({ proxyUrl } = {}) {
  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  };
  if (proxyUrl) {
    launchOpts.proxy = { server: proxyUrl };
  }
  return chromium.launch(launchOpts);
}

async function createStealthContext(browser) {
  const context = await browser.newContext({
    userAgent: DEFAULT_UA,
    viewport: { width: 1920, height: 1080 },
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    deviceScaleFactor: 2,
    hasTouch: false,
    isMobile: false,
    extraHTTPHeaders: {
      'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
    Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
    Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU', 'ru', 'en-US', 'en'] });
    window.chrome = { runtime: {}, app: {}, csi: () => {}, loadTimes: () => {} };
    if (typeof PluginArray !== 'undefined') {
      Object.defineProperty(navigator, 'plugins', {
        get: () => Object.setPrototypeOf([
          { 0: { type: 'application/x-google-chrome-pdf' }, description: 'PDF', filename: 'internal-pdf-viewer', length: 1, name: 'Chrome PDF Plugin' },
          { 0: { type: 'application/x-nacl' }, description: 'Native Client', filename: 'internal-nacl-plugin', length: 1, name: 'Native Client' },
        ], PluginArray.prototype),
      });
    }
  });

  return context;
}

function toOffer(source, item, normalizedQuery, retrievalMode = 'live_playwright') {
  const score = scoreOffer(normalizedQuery.tokens, item);
  return {
    source,
    title: item.title,
    price: item.price,
    image_url: item.image_url ?? '',
    product_url: item.product_url ?? '',
    features: item.features ?? [],
    currency: 'RUB',
    availability: item.availability ?? 'unknown',
    matched_query: normalizedQuery.original,
    normalized_query: normalizedQuery.normalized,
    relevance_score: score,
    fetched_at: new Date().toISOString(),
    raw_payload: {
      ...item,
      retrieval_mode: retrievalMode,
      source_url: item.product_url ?? '',
    },
  };
}

// ─── WILDBERRIES ──────────────────────────────────────────────────────────────

// WB throttles headless-Chromium by TLS fingerprint (498/429), but a plain Node fetch
// passes like curl. So WB uses direct fetch with retries, not the browser.
// Blocks float per-IP, so we rotate endpoints/regions/UA and jitter the backoff.
//
// Two endpoint styles, tried in order (per Duff89/wb_parse_search_phrase, verified
// May 2026): the newer v18 lives behind the same-origin www.wildberries.ru/__internal
// path, the legacy v9 on the search.wb.ru subdomain. The www path expects front-end
// XHR headers (x-spa-version, x-requested-with, sec-ch-ua), so we send those.
const WB_DESTS = ['-1257786', '-1275551', '12358062', '-446031'];
const WB_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  DEFAULT_UA,
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

function pick(arr, i) {
  return arr[i % arr.length];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Build a WB search URL. style 'v18' → same-origin www path; 'v9' → search.wb.ru.
function buildWbUrl(style, dest, query) {
  const q = encodeURIComponent(query);
  if (style === 'v18') {
    return `https://www.wildberries.ru/__internal/u-search/exactmatch/ru/common/v18/search`
      + `?ab_testid=promo_mask_test_1&appType=1&autoselectFilters=false&curr=rub&dest=${dest}`
      + `&hide_dtype=9&hide_vflags=4294967296&inheritFilters=false&lang=ru&page=1`
      + `&query=${q}&resultset=catalog&spp=30&suppressSpellcheck=false`;
  }
  return `https://search.wb.ru/exactmatch/ru/common/v9/search?appType=1&curr=rub&dest=${dest}&query=${q}&resultset=catalog&sort=popular&spp=30&suppressSpellcheck=false&lang=ru`;
}

// Headers mimicking the WB SPA's own XHR (front-end fingerprint). The www/__internal
// endpoint rejects bare requests; these make it look same-origin.
function buildWbHeaders(style, ua, query) {
  if (style === 'v18') {
    return {
      'accept': '*/*',
      'accept-language': 'ru-RU,ru;q=0.9',
      'priority': 'u=1, i',
      'referer': `https://www.wildberries.ru/catalog/0/search.aspx?search=${encodeURIComponent(query)}`,
      'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': ua,
      'x-requested-with': 'XMLHttpRequest',
      'x-spa-version': '13.21.4',
      'x-userid': '0',
    };
  }
  return {
    'Accept': '*/*',
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    'Origin': 'https://www.wildberries.ru',
    'Referer': 'https://www.wildberries.ru/',
    'User-Agent': ua,
  };
}

// Global WB request throttle — enforces minimum gap between consecutive WB API calls
// regardless of which adapter instance triggered them. WB rate-limits at ~3-5 rps
// on v18 and ~8 rps on v9; 500ms floor keeps us safely below both.
let _wbLastRequestAt = 0;
const WB_MIN_INTERVAL_MS = 500;

async function wbThrottle() {
  const now = Date.now();
  const wait = WB_MIN_INTERVAL_MS - (now - _wbLastRequestAt);
  if (wait > 0) await sleep(wait);
  _wbLastRequestAt = Date.now();
}

async function fetchWbApiWithRetry(query, { timeoutMs = 15000, maxRetries = 4 } = {}) {
  let lastStatus = 0;
  let lastUrl = '';
  for (let i = 0; i < maxRetries; i += 1) {
    // Alternate endpoint style (v18 ↔ v9), region and UA to dodge per-IP throttling.
    const style = i % 2 === 0 ? 'v18' : 'v9';
    const dest = pick(WB_DESTS, Math.floor(i / 2));
    const url = buildWbUrl(style, dest, query);
    lastUrl = url;
    const headers = buildWbHeaders(style, pick(WB_USER_AGENTS, i), query);
    await wbThrottle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { headers, signal: controller.signal });
      lastStatus = resp.status;
      const text = await resp.text();
      if (resp.ok && text.trimStart().startsWith('{')) {
        const json = JSON.parse(text);
        const prods = json.data?.products ?? json.products ?? [];
        if (prods.length > 0) {
          return { ok: true, status: resp.status, json, url, attempt: i + 1 };
        }
        // 200 but empty (spellcheck/region mismatch) — try next region.
      }
      // Respect Retry-After if WB sends it on 429.
      const retryAfter = Number(resp.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        await sleep(Math.min(retryAfter * 1000, 10000));
        continue;
      }
    } catch { /* network/abort — retry */ } finally {
      clearTimeout(timer);
    }
    // Exponential backoff with jitter: ~0.6–1.4× of base, capped, so retries aren't rhythmic.
    const base = Math.min(800 * 2 ** i, 4000);
    await sleep(Math.round(base * (0.6 + Math.random() * 0.8)));
  }
  return { ok: false, status: lastStatus, json: null, url: lastUrl, attempt: maxRetries };
}

async function scrapeWildberriesApi({ normalizedQuery, limit = 20, timeoutMs = 15000 } = {}) {
  const attempts = [];

  const res = await fetchWbApiWithRetry(normalizedQuery.original, { timeoutMs });
  attempts.push({
    step: 'search_api_fetch',
    endpoint: res.url.slice(0, 100),
    status: res.status,
    blocked: !res.ok,
    ok: res.ok,
    retries: res.attempt,
  });

  if (!res.ok) {
    return { offers: [], attempts, liveHit: false };
  }

  const products = res.json.data?.products ?? res.json.products ?? [];
  const seen = new Set();
  const offers = [];

  for (const product of products) {
    const id = product.id ?? product.nmId ?? product.nmID;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    // v9 API nests price in sizes[].price.{product,total} (kopecks); older shape uses salePriceU/priceU.
    const sizePrice = product.sizes?.find((s) => s?.price)?.price;
    const rawPrice = sizePrice?.product ?? sizePrice?.total
      ?? product.salePriceU ?? product.priceU ?? product.price;
    const price = normalizePrice(rawPrice);
    if (!product.name || !Number.isFinite(price)) continue;

    // WB CDN image URL: basket number derived from nmId (verified formula May 2026)
    const vol = Math.floor(id / 100000);
    const part = Math.floor(id / 1000);
    const basket = (
      vol <= 143 ? '01' : vol <= 287 ? '02' : vol <= 431 ? '03' : vol <= 719 ? '04' :
      vol <= 1007 ? '05' : vol <= 1061 ? '06' : vol <= 1115 ? '07' : vol <= 1169 ? '08' :
      vol <= 1313 ? '09' : vol <= 1601 ? '10' : vol <= 1655 ? '11' : vol <= 1919 ? '12' :
      vol <= 2045 ? '13' : vol <= 2189 ? '14' : vol <= 2405 ? '15' : vol <= 2621 ? '16' :
      vol <= 2837 ? '17' : vol <= 3053 ? '18' : vol <= 3269 ? '19' : vol <= 3485 ? '20' :
      vol <= 3701 ? '21' : vol <= 3917 ? '22' : vol <= 4133 ? '23' : vol <= 4349 ? '24' : '25'
    );
    const image_url = `https://basket-${basket}.wbbasket.ru/vol${vol}/part${part}/${id}/images/c246x328/1.jpg`;

    offers.push(toOffer('wildberries', {
      title: product.name ?? '',
      price,
      image_url,
      product_url: `https://www.wildberries.ru/catalog/${id}/detail.aspx`,
      features: [product.brand, product.subjectName].filter(Boolean),
      availability: 'unknown',
    }, normalizedQuery, 'live_wb_api'));

    if (offers.length >= limit) break;
  }

  return {
    offers: offers.sort((a, b) => b.relevance_score - a.relevance_score || a.price - b.price),
    attempts,
    liveHit: offers.length > 0,
  };
}

// ─── OZON ─────────────────────────────────────────────────────────────────────

function parseOzonProducts(html) {
  const products = [];
  // Try JSON-LD first
  const jsonLdRegex = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = jsonLdRegex.exec(html)) !== null) {
    try {
      const j = JSON.parse(m[1]);
      const items = Array.isArray(j) ? j : [j];
      for (const item of items) {
        if (item['@type'] === 'Product' || item['@type'] === 'ItemList') {
          products.push(item);
        }
      }
    } catch { /* ignore */ }
  }
  if (products.length > 0) return products;

  // Try __NEXT_DATA__
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      const j = JSON.parse(nextMatch[1]);
      extractProductsFromObj(j, products, new Set());
    } catch { /* ignore */ }
  }
  return products;
}

function extractProductsFromObj(node, results, seen) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);

  const hasName = typeof node.name === 'string' || typeof node.title === 'string';
  const hasPrice = node.price != null || node.finalPrice != null;
  if (hasName && hasPrice) results.push(node);

  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((e) => extractProductsFromObj(e, results, seen));
    else if (v && typeof v === 'object') extractProductsFromObj(v, results, seen);
  }
}

async function scrapeOzonPlaywright({ normalizedQuery, limit = 20, timeoutMs = 60000, proxyUrl } = {}) {
  const attempts = [];
  const browser = await launchBrowser({ proxyUrl }).catch((err) => {
    attempts.push({ step: 'browser_launch', blocked: true, error_message: err.message });
    return null;
  });

  if (!browser) return { offers: [], attempts, liveHit: false };

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    const apiProducts = [];

    // Intercept Ozon API responses
    page.on('response', async (resp) => {
      const url = resp.url();
      if (resp.status() === 200 && (url.includes('entrypoint-api') || url.includes('composer-api'))) {
        try {
          const text = await resp.text();
          if (!text.startsWith('{')) return;
          const j = JSON.parse(text);
          const widgets = j?.catalog?.searchResultsV2 ?? {};
          for (const widget of Object.values(widgets)) {
            if (!Array.isArray(widget?.items)) continue;
            for (const item of widget.items) {
              const info = item?.cellTrackingInfo ?? {};
              const price = parsePrice(info.finalPrice ?? info.price);
              if (info.title && Number.isFinite(price)) {
                apiProducts.push({
                  title: info.title,
                  price,
                  image_url: info.image ?? item?.image ?? '',
                  product_url: `https://www.ozon.ru${item?.url ?? info.url ?? ''}`,
                  features: [info.brand, info.category].filter(Boolean),
                  availability: info.availability === 1 ? 'in_stock' : 'unknown',
                });
              }
            }
          }
        } catch { /* ignore */ }
      }
    });

    const searchUrl = `https://www.ozon.ru/search/?text=${encodeURIComponent(normalizedQuery.original)}&from_global=true`;
    attempts.push({ step: 'search_page', endpoint: searchUrl, blocked: false, ok: true });
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(8000);

    const title = await page.title();
    const isBlocked = title.includes('Доступ ограничен') || title.includes('captcha') || title.toLowerCase().includes('access');

    if (isBlocked) {
      attempts[attempts.length - 1].blocked = true;
      // Try to extract from page HTML anyway
      const html = await page.content();
      const htmlProducts = parseOzonProducts(html);
      if (htmlProducts.length > 0 && apiProducts.length === 0) {
        apiProducts.push(...htmlProducts);
      }
    }

    // Collect from intercepted API or HTML fallback
    let allProducts = apiProducts;
    if (allProducts.length === 0) {
      try {
        const html = await page.content();
        allProducts = parseOzonProducts(html).map(p => ({
          title: p.name ?? p.title ?? '',
          price: p.price ?? 0,
          image_url: p.image ?? p.image_url ?? '',
          product_url: p.url ?? p.product_url ?? '',
          features: [],
          availability: 'unknown',
        })).filter(p => p.title && p.price > 0);
      } catch { /* ignore */ }
    }

    const seen = new Set();
    const offers = [];
    for (const product of allProducts) {
      const key = product.title + ':' + product.price;
      if (seen.has(key)) continue;
      seen.add(key);

      offers.push(toOffer('ozon', product, normalizedQuery, 'live_ozon_playwright'));
      if (offers.length >= limit) break;
    }

    await browser.close();
    return {
      offers: offers.sort((a, b) => b.relevance_score - a.relevance_score || a.price - b.price),
      attempts,
      liveHit: offers.length > 0,
    };
  } catch (err) {
    attempts.push({ step: 'scrape', blocked: true, error_message: err.message });
    await browser.close().catch(() => {});
    return { offers: [], attempts, liveHit: false };
  }
}

// ─── ЯНДЕКС МАРКЕТ ────────────────────────────────────────────────────────────

function parseYandexMarketProducts(html) {
  const products = [];

  // Primary: noframes[data-apiary="patch"] JSON blobs — collections.product + collections.offer
  const noframesRe = /<noframes[^>]*data-apiary="patch"[^>]*>([\s\S]*?)<\/noframes>/gi;
  let m;
  while ((m = noframesRe.exec(html)) !== null) {
    try {
      const blob = JSON.parse(m[1]);
      const collections = blob?.collections ?? {};
      for (const collData of Object.values(collections)) {
        if (!collData || typeof collData !== 'object') continue;
        for (const [id, p] of Object.entries(collData)) {
          if (p && typeof p === 'object' && (p.titles?.raw || p.titles?.highlighted)) {
            products.push({ _ymId: id, ...p });
          }
        }
      }
    } catch { /* ignore */ }
  }
  if (products.length > 0) return products;

  // Fallback: JSON-LD
  const jsonLdRegex = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = jsonLdRegex.exec(html)) !== null) {
    try {
      const items = [].concat(JSON.parse(m[1]));
      for (const item of items) {
        if (item['@type'] === 'Product') products.push(item);
        if (item['@type'] === 'ItemList') {
          for (const el of item.itemListElement ?? []) {
            if (el?.item?.['@type'] === 'Product') products.push(el.item);
          }
        }
      }
    } catch { /* ignore */ }
  }

  return products;
}

function extractYMProducts(node, results, seen) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);

  const hasId = node.id != null || node.skuId != null || node.offerId != null;
  const hasName = typeof node.name === 'string' || typeof node.title === 'string';
  const hasPrice = node.price != null || node.prices != null || node.priceMin != null;
  if (hasId && hasName && hasPrice) results.push(node);

  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((e) => extractYMProducts(e, results, seen));
    else if (v && typeof v === 'object') extractYMProducts(v, results, seen);
  }
}

function ymProductToItem(product) {
  // noframes format uses titles.raw; legacy API format uses name/title
  const name = product.titles?.raw ?? product.titles?.highlighted ?? product.name ?? product.title ?? '';
  // noframes: prices.min (string kopecks or roubles); legacy: price.value / prices.min.value
  const priceRaw = product.prices?.min ?? product.price?.value ?? product.price?.min
    ?? product.prices?.min?.value ?? product.priceMin ?? product.price;
  const price = parsePrice(priceRaw);
  if (!name || !Number.isFinite(price)) return null;

  const imageObj = product.picture ?? product.image ?? product.photo;
  const imageUrl = typeof imageObj === 'string' ? imageObj : imageObj?.url ?? imageObj?.original ?? '';
  const id = product._ymId ?? product.id;
  const slug = product.slug;
  const productUrl = product.url
    ?? (slug && id ? `https://market.yandex.ru/product--${slug}/${id}` : '')
    ?? (id ? `https://market.yandex.ru/product/${id}` : '');

  return {
    title: name,
    price,
    image_url: imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl,
    product_url: productUrl,
    features: [product.brand, product.category?.name].filter(Boolean),
    availability: product.delivery ? 'in_stock' : 'unknown',
  };
}

// Static search-context token — same value works for any query, bypasses VPN/ASN block.
// Verified May 2026: plain HTTP GET returns STATUS:200 with full product HTML.
const YM_RS_TOKEN = 'eJwzEv_EKMLBKLDwEKsEg8azbh6NVUdYNT6fYQUAWiMIFg,,';

async function scrapeYandexMarketFetch({ normalizedQuery, limit = 20, timeoutMs = 15000 } = {}) {
  const attempts = [];
  const url = `https://market.yandex.ru/search?text=${encodeURIComponent(normalizedQuery.original)}&rs=${encodeURIComponent(YM_RS_TOKEN)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const ymCookie = process.env.YM_COOKIE ?? '';
  try {
    const resp = await fetch(url, {
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ru-RU,ru;q=0.9',
        'user-agent': DEFAULT_UA,
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        ...(ymCookie ? { 'cookie': ymCookie } : {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const html = await resp.text();
    attempts.push({ step: 'ym_fetch', endpoint: url.slice(0, 100), status: resp.status, blocked: !resp.ok, ok: resp.ok });
    if (!resp.ok) return { offers: [], attempts, liveHit: false };

    const rawProducts = parseYandexMarketProducts(html);
    attempts[0].items_found = rawProducts.length;

    const seen = new Set();
    const offers = [];
    for (const p of rawProducts) {
      const item = ymProductToItem(p);
      if (!item) continue;
      const key = item.title + ':' + item.price;
      if (seen.has(key)) continue;
      seen.add(key);
      offers.push(toOffer('yandex_market', item, normalizedQuery, 'live_ym_fetch'));
      if (offers.length >= limit) break;
    }
    return {
      offers: offers.sort((a, b) => b.relevance_score - a.relevance_score || a.price - b.price),
      attempts,
      liveHit: offers.length > 0,
    };
  } catch (err) {
    clearTimeout(timer);
    attempts.push({ step: 'ym_fetch', blocked: true, error_message: err.message });
    return { offers: [], attempts, liveHit: false };
  }
}

async function scrapeYandexMarketPlaywright({ normalizedQuery, limit = 20, timeoutMs = 60000, proxyUrl } = {}) {
  const attempts = [];
  const browser = await launchBrowser({ proxyUrl }).catch((err) => {
    attempts.push({ step: 'browser_launch', blocked: true, error_message: err.message });
    return null;
  });

  if (!browser) return { offers: [], attempts, liveHit: false };

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    const apiProducts = [];

    // Intercept YM API responses
    page.on('response', async (resp) => {
      const url = resp.url();
      if (resp.status() === 200 && url.includes('market.yandex.ru') && url.includes('/api/')) {
        try {
          const text = await resp.text();
          if (!text.startsWith('{') && !text.startsWith('[')) return;
          const j = JSON.parse(text);
          const items = j?.results ?? j?.offers ?? j?.items ?? j?.searchResults ?? [];
          if (Array.isArray(items)) {
            for (const item of items) {
              const parsed = ymProductToItem(item);
              if (parsed) apiProducts.push(parsed);
            }
          }
        } catch { /* ignore */ }
      }
    });

    const searchUrl = `https://market.yandex.ru/search?text=${encodeURIComponent(normalizedQuery.original)}`;
    attempts.push({ step: 'search_page', endpoint: searchUrl, blocked: false, ok: true });
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(8000);

    const title = await page.title();
    const isBlocked = title.includes('VPN') || title.includes('captcha') || title.includes('Вы не робот');

    if (isBlocked && apiProducts.length === 0) {
      attempts[attempts.length - 1].blocked = true;
    }

    // Extract from page HTML if API didn't give us anything
    if (apiProducts.length === 0) {
      const html = await page.content();
      const htmlProducts = parseYandexMarketProducts(html);
      for (const product of htmlProducts) {
        const item = ymProductToItem(product);
        if (item) apiProducts.push(item);
      }
    }

    const seen = new Set();
    const offers = [];
    for (const product of apiProducts) {
      const key = product.title + ':' + product.price;
      if (seen.has(key)) continue;
      seen.add(key);

      offers.push(toOffer('yandex_market', product, normalizedQuery, 'live_ym_playwright'));
      if (offers.length >= limit) break;
    }

    await browser.close();
    return {
      offers: offers.sort((a, b) => b.relevance_score - a.relevance_score || a.price - b.price),
      attempts,
      liveHit: offers.length > 0,
    };
  } catch (err) {
    attempts.push({ step: 'scrape', blocked: true, error_message: err.message });
    await browser.close().catch(() => {});
    return { offers: [], attempts, liveHit: false };
  }
}

// ─── STEALTH-FIRST WRAPPERS ──────────────────────────────────────────────────
//
// Ozon and Yandex Market fingerprint and block local headless Chromium. If a stealth
// browser service is reachable (STEALTH_BROWSER_URL, default http://127.0.0.1:9377),
// route through it first; otherwise fall back to the Playwright path so the demo never
// hard-fails. Dynamic import avoids a static import cycle (stealth-scraper imports the
// parsers from this module).

async function withStealthFallback(stealthName, playwrightFn, opts) {
  try {
    const sb = await import('./stealth-browser.js');
    if (await sb.isAvailable()) {
      const mod = await import('./stealth-scraper.js');
      const res = await mod[stealthName](opts);
      if (res.liveHit) return res;
      // Stealth reachable but empty (block/parse miss) — try Playwright, keep both attempt trails.
      const fb = await playwrightFn(opts);
      return { ...fb, attempts: [...res.attempts, ...fb.attempts] };
    }
  } catch (err) {
    // Stealth layer threw (network/import) — degrade silently to Playwright.
    const fb = await playwrightFn(opts);
    fb.attempts.unshift({ step: 'stealth_unavailable', blocked: false, error_message: err.message });
    return fb;
  }
  return playwrightFn(opts);
}

// WB: try direct API fetch first (cheap, works on a clean IP); only fall back to the
// stealth browser DOM path if the API is blocked (429/498) and the service is up.
// enrichSpecs=true fetches full tech specs from each product page (slower, more data).
async function scrapeWildberries(opts = {}) {
  const api = await scrapeWildberriesApi(opts);
  if (api.liveHit) return api;
  try {
    const sb = await import('./stealth-browser.js');
    if (await sb.isAvailable()) {
      const mod = await import('./stealth-scraper.js');
      const dom = await mod.scrapeWildberriesStealth(opts);
      return { ...dom, attempts: [...api.attempts, ...dom.attempts] };
    }
  } catch (err) {
    api.attempts.push({ step: 'stealth_unavailable', blocked: false, error_message: err.message });
  }
  return api;
}

function scrapeOzon(opts = {}) {
  return withStealthFallback('scrapeOzonStealth', scrapeOzonPlaywright, opts);
}

async function scrapeYandexMarket(opts = {}) {
  const direct = await scrapeYandexMarketFetch(opts);
  if (direct.liveHit) return direct;
  const fb = await withStealthFallback('scrapeYandexMarketStealth', scrapeYandexMarketPlaywright, opts);
  return { ...fb, attempts: [...direct.attempts, ...fb.attempts] };
}

export {
  scrapeWildberries,
  scrapeWildberriesApi,
  scrapeOzon,
  scrapeYandexMarket,
  scrapeOzonPlaywright,
  scrapeYandexMarketPlaywright,
  scrapeYandexMarketFetch,
  // Shared by the stealth-scraper path (reuses parsers/normalizers).
  parseOzonProducts,
  parseYandexMarketProducts,
  ymProductToItem,
  parsePrice,
  normalizePrice,
  toOffer,
};
