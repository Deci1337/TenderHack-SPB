import { scoreOffer } from './query.js';

const BLOCK_PATTERNS = [
  /доступ ограничен/i,
  /похоже, вы используете vpn/i,
  /похоже, нет соединения/i,
  /captcha/i,
  /forbidden/i,
  /access denied/i,
];

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function collectJsonLdProducts(node, results = [], seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) {
    return results;
  }

  seen.add(node);

  const type = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
  if (type.includes('Product')) {
    results.push(node);
  }

  if (Array.isArray(node.itemListElement)) {
    for (const item of node.itemListElement) {
      if (item?.item) {
        collectJsonLdProducts(item.item, results, seen);
      } else {
        collectJsonLdProducts(item, results, seen);
      }
    }
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const entry of value) collectJsonLdProducts(entry, results, seen);
    } else if (value && typeof value === 'object') {
      collectJsonLdProducts(value, results, seen);
    }
  }

  return results;
}

function collectProductLikeObjects(node, results = [], seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) {
    return results;
  }

  seen.add(node);

  const hasName = typeof node.name === 'string' || typeof node.title === 'string';
  const offers = node.offers;
  const hasPrice =
    typeof node.price === 'number' ||
    typeof node.price === 'string' ||
    (Array.isArray(offers) && offers.some((entry) => entry && (entry.price != null || entry.priceValue != null))) ||
    (!Array.isArray(offers) && offers && (offers.price != null || offers.priceValue != null));
  const hasMedia = Boolean(node.image || node.url);

  if (hasName && hasPrice && hasMedia) {
    results.push(node);
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const entry of value) collectProductLikeObjects(entry, results, seen);
    } else if (value && typeof value === 'object') {
      collectProductLikeObjects(value, results, seen);
    }
  }

  return results;
}

function normalizeOzonPrice(value) {
  if (value == null) return NaN;
  const numeric = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : NaN;
}

function extractOzonSearchResultWidgets(payload) {
  const widgets = [];
  const searchResults = payload?.catalog?.searchResultsV2;
  if (!searchResults || typeof searchResults !== 'object') {
    return widgets;
  }

  for (const widget of Object.values(searchResults)) {
    if (widget && Array.isArray(widget.items)) {
      widgets.push(widget);
    }
  }

  return widgets;
}

function ozonItemToProduct(item, sourceUrl) {
  const info = item?.cellTrackingInfo ?? {};
  const price = normalizeOzonPrice(info.finalPrice ?? info.price);
  if (!info.title || !Number.isFinite(price)) {
    return null;
  }

  const features = [
    info.brand ? `brand: ${info.brand}` : null,
    info.category ? `category: ${info.category}` : null,
    info.deliverySchema ? `delivery: ${info.deliverySchema}` : null,
  ].filter(Boolean);

  return {
    title: info.title,
    price,
    image_url: info.image ?? item?.image ?? '',
    product_url: item?.url ?? item?.link ?? info.url ?? info.link ?? '',
    features,
    currency: 'RUB',
    availability: info.availability === 1 ? 'in_stock' : info.availability === 0 ? 'out_of_stock' : 'unknown',
    additionalProperty: features.map((value) => {
      const [name, ...rest] = value.split(':');
      return { name: name.trim(), value: rest.join(':').trim() };
    }),
    raw_payload: {
      ...info,
      source_url: sourceUrl,
    },
  };
}

export function extractOzonProducts(payload, sourceUrl = '') {
  const searchWidgets = extractOzonSearchResultWidgets(payload);
  const products = [];

  for (const widget of searchWidgets) {
    for (const item of widget.items) {
      const product = ozonItemToProduct(item, sourceUrl);
      if (product) {
        products.push(product);
      }
    }
  }

  return products;
}

function isOzonChallengePayload(payload) {
  return Boolean(payload && typeof payload === 'object' && (payload.challengeURL || payload.incidentId));
}

async function fetchOzonComposerJson(url, { fetchImpl = globalThis.fetch, userAgent, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        'user-agent': userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        accept: 'application/json,text/plain,*/*',
        'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
      redirect: 'manual',
    });

    const text = await response.text();
    const json = safeJsonParse(text);
    return {
      ok: response.ok,
      status: response.status,
      json,
      text,
      finalUrl: response.url ?? url,
      blocked: response.status === 403 || response.status === 429 || response.status === 307 || isOzonChallengePayload(json),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      json: null,
      text: '',
      finalUrl: url,
      blocked: true,
      error,
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildOzonComposerUrls(urls, page) {
  return urls.map((url) => {
    const parsed = new URL(url);
    parsed.searchParams.set('page', String(page));
    return parsed.toString();
  });
}

function buildOzonSearchUrls(normalizedQuery) {
  const searchQuery = encodeURIComponent(normalizedQuery);
  const searchPath = `/search/?text=${searchQuery}&from_global=true`;
  return [
    `https://api.ozon.ru/composer-api.bx/page/json/v1?url=${encodeURIComponent(searchPath)}`,
    `https://api.ozon.ru/composer-api.bx/page/json/v2?url=${encodeURIComponent(searchPath)}`,
    `https://www.ozon.ru/api/composer-api.bx/page/json/v1?url=${encodeURIComponent(searchPath)}`,
    `https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=${encodeURIComponent(searchPath)}`,
  ];
}

function ozonPageCount(payload) {
  const header = payload?.catalog?.catalogResultsHeader;
  const headerWidget = header && typeof header === 'object' ? Object.values(header).at(-1) : null;
  const totalFound = headerWidget?.cellTrackingInfo?.countItems;
  const widgets = extractOzonSearchResultWidgets(payload);
  const perPage = widgets[0]?.items?.length ?? 0;
  const total = Number(totalFound);

  if (!Number.isFinite(total) || total <= 0 || perPage <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(total / perPage));
}

export async function fetchAndParseOzonOffers({
  normalizedQuery,
  fetchImpl,
  source = 'ozon',
  timeoutMs = 15000,
}) {
  const attempts = [];
  const baseUrls = buildOzonSearchUrls(normalizedQuery.normalized);
  const collected = [];
  const firstUrl = baseUrls[0];
  const firstPage = await fetchOzonComposerJson(firstUrl, { fetchImpl, timeoutMs });

  attempts.push({
    url: firstUrl,
    final_url: firstPage.finalUrl,
    status: firstPage.status,
    blocked: firstPage.blocked,
    ok: firstPage.ok,
    json_keys: firstPage.json ? Object.keys(firstPage.json).slice(0, 10) : [],
    error_name: firstPage.error?.name,
    error_message: firstPage.error?.message,
    error_cause: firstPage.error?.cause?.message,
  });

  if (!firstPage.ok || firstPage.blocked || !firstPage.json) {
    return { offers: [], attempts, liveHit: false };
  }

  const firstProducts = extractOzonProducts(firstPage.json, firstPage.finalUrl);
  if (firstProducts.length > 0) {
    collected.push(...offersFromProducts(firstProducts, {
      source,
      normalizedQuery,
      sourceUrl: firstPage.finalUrl,
      retrievalMode: 'live_ozon_api',
    }));
  }

  const pages = ozonPageCount(firstPage.json);
  for (let page = 2; page <= pages; page += 1) {
    const pageUrls = buildOzonComposerUrls(baseUrls, page);
    for (const url of pageUrls) {
      const fetched = await fetchOzonComposerJson(url, { fetchImpl, timeoutMs });
      attempts.push({
        url,
        final_url: fetched.finalUrl,
        status: fetched.status,
        blocked: fetched.blocked,
        ok: fetched.ok,
        json_keys: fetched.json ? Object.keys(fetched.json).slice(0, 10) : [],
        error_name: fetched.error?.name,
        error_message: fetched.error?.message,
        error_cause: fetched.error?.cause?.message,
      });

      if (!fetched.ok || fetched.blocked || !fetched.json) {
        continue;
      }

      const products = extractOzonProducts(fetched.json, fetched.finalUrl);
      if (products.length === 0) {
        continue;
      }

      collected.push(...offersFromProducts(products, {
        source,
        normalizedQuery,
        sourceUrl: fetched.finalUrl,
        retrievalMode: 'live_ozon_api',
      }));
      break;
    }
  }

  if (collected.length > 0) {
    return {
      offers: collected.sort((a, b) => b.relevance_score - a.relevance_score || a.price - b.price),
      attempts,
      liveHit: true,
    };
  }

  return {
    offers: [],
    attempts,
    liveHit: false,
  };
}

export function isBlockedResponse(status, html) {
  if ([403, 429, 498].includes(status)) return true;
  return BLOCK_PATTERNS.some((pattern) => pattern.test(html));
}

export function extractJsonLdProducts(html) {
  const products = [];
  const scriptPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptPattern.exec(html))) {
    const data = safeJsonParse(match[1].trim());
    if (!data) continue;

    if (Array.isArray(data)) {
      for (const entry of data) {
        collectJsonLdProducts(entry, products);
      }
    } else {
      collectJsonLdProducts(data, products);
    }
  }

  return products;
}

export function extractNextDataProducts(html) {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) {
    return [];
  }

  const data = safeJsonParse(match[1].trim());
  if (!data) {
    return [];
  }

  return collectProductLikeObjects(data);
}

function normalizeAvailability(value) {
  if (!value) return 'unknown';
  const text = String(value).toLowerCase();
  if (text.includes('instock')) return 'in_stock';
  if (text.includes('outofstock')) return 'out_of_stock';
  return 'unknown';
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function productToItem(product) {
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const image = toArray(product.image)[0] ?? '';
  return {
    title: product.name ?? product.title ?? '',
    image_url: image,
    product_url: product.url ?? offer?.url ?? '',
    price: Number(offer?.price ?? product.price),
    currency: offer?.priceCurrency ?? product.priceCurrency ?? 'RUB',
    features: toArray(product.additionalProperty)
      .map((entry) => {
        if (!entry) return null;
        if (typeof entry === 'string') return entry;
        if (entry.name && entry.value) return `${entry.name}: ${entry.value}`;
        return null;
      })
      .filter(Boolean),
    availability: normalizeAvailability(offer?.availability),
    raw_payload: product,
  };
}

export function offersFromProducts(products, { source, normalizedQuery, sourceUrl, retrievalMode }) {
  return products
    .map((product) => productToItem(product))
    .filter((item) => item.title && Number.isFinite(item.price))
    .map((item) => ({
      source,
      title: item.title,
      price: item.price,
      image_url: item.image_url,
      product_url: item.product_url,
      features: item.features,
      currency: item.currency,
      availability: item.availability,
      matched_query: normalizedQuery.original,
      normalized_query: normalizedQuery.normalized,
      relevance_score: scoreOffer(normalizedQuery.tokens, item),
      fetched_at: new Date().toISOString(),
      raw_payload: {
        ...item.raw_payload,
        retrieval_mode: retrievalMode,
        source_url: sourceUrl,
      },
    }))
    .sort((a, b) => b.relevance_score - a.relevance_score || a.price - b.price);
}

export async function fetchHtml(url, { fetchImpl = globalThis.fetch, userAgent, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        'user-agent': userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });

    const html = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      html,
      finalUrl: response.url ?? url,
      blocked: isBlockedResponse(response.status, html),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      html: '',
      finalUrl: url,
      blocked: true,
      error,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAndParseOffers({
  source,
  normalizedQuery,
  urls,
  fetchImpl,
  parser = extractJsonLdProducts,
  collectAll = false,
  retrievalMode = 'live',
  timeoutMs = 15000,
}) {
  const attempts = [];
  const collectedOffers = [];

  for (const url of urls) {
    const fetched = await fetchHtml(url, { fetchImpl, timeoutMs });
    attempts.push({
      url,
      final_url: fetched.finalUrl,
      status: fetched.status,
      blocked: fetched.blocked,
      ok: fetched.ok,
      html_length: fetched.html?.length ?? 0,
      error_name: fetched.error?.name,
      error_message: fetched.error?.message,
      error_cause: fetched.error?.cause?.message,
    });
    if (!fetched.ok || fetched.blocked || !fetched.html) {
      continue;
    }

    const products = parser(fetched.html);
    const structuredProducts = products.length ? products : extractNextDataProducts(fetched.html);
    if (!structuredProducts.length) {
      continue;
    }

    const offers = offersFromProducts(structuredProducts, {
      source,
      normalizedQuery,
      sourceUrl: fetched.finalUrl,
      retrievalMode,
    });

    if (collectAll) {
      collectedOffers.push(...offers);
      continue;
    }

    return {
      offers,
      attempts,
      liveHit: true,
    };
  }

  if (collectAll && collectedOffers.length > 0) {
    return {
      offers: collectedOffers.sort((a, b) => b.relevance_score - a.relevance_score || a.price - b.price),
      attempts,
      liveHit: true,
    };
  }

  return {
    offers: [],
    attempts,
    liveHit: false,
  };
}
