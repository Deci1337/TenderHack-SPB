import { scoreOffer } from './query.js';

const BLOCKED_STATUSES = new Set([403, 429, 498]);
const API_BLOCK_PATTERNS = [/challenge/i, /captcha/i, /access denied/i, /forbidden/i];

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function headersToObject(headers) {
  if (!headers || typeof headers.entries !== 'function') {
    return {};
  }
  return Object.fromEntries([...headers.entries()].map(([key, value]) => [key.toLowerCase(), String(value)]));
}

function isApiBlocked(status, bodyText, headerMap) {
  if (BLOCKED_STATUSES.has(status)) {
    return true;
  }
  if (headerMap['x-wbaas-token'] === 'get' || headerMap['x-pow']) {
    return true;
  }
  return API_BLOCK_PATTERNS.some((pattern) => pattern.test(bodyText ?? ''));
}

function normalizePrice(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  if (raw >= 1000) return Math.round(raw / 100);
  return Math.round(raw);
}

function toList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function buildAuthHeaders({ token, cookie, pow } = {}) {
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    accept: 'application/json, text/plain, */*',
    'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
  };

  if (token) {
    headers['x-wbaas-token'] = token;
    headers.cookie = cookie
      ? `${cookie}; x_wbaas_token=${token}`
      : `x_wbaas_token=${token}`;
  } else if (cookie) {
    headers.cookie = cookie;
  }

  if (pow) {
    headers['x-pow'] = pow;
  }

  return headers;
}

async function fetchJson(url, { fetchImpl, headers, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });

    const bodyText = await response.text();
    const headerMap = headersToObject(response.headers);
    const blocked = isApiBlocked(response.status, bodyText, headerMap);

    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url ?? url,
      blocked,
      headerMap,
      bodyText,
      json: safeJsonParse(bodyText),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      blocked: true,
      headerMap: {},
      bodyText: '',
      json: null,
      error,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAuthEnvelope(url, { fetchImpl, bearerToken, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  try {
    const headers = {
      accept: 'application/json, text/plain, */*',
    };
    if (bearerToken) {
      headers.authorization = `Bearer ${bearerToken}`;
    }

    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });

    const bodyText = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url ?? url,
      bodyText,
      json: safeJsonParse(bodyText),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      bodyText: '',
      json: null,
      error,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractSearchProducts(payload) {
  const direct = payload?.data?.products ?? payload?.products;
  if (Array.isArray(direct)) {
    return direct.filter((entry) => entry && typeof entry === 'object');
  }

  const seen = new Set();
  const results = [];

  function walk(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const entry of node) walk(entry);
      return;
    }

    const id = node.id ?? node.nmId ?? node.nmID;
    const hasName = typeof node.name === 'string' || typeof node.title === 'string';
    const hasPrice = node.salePriceU != null || node.priceU != null || node.price != null;
    if (Number.isFinite(Number(id)) && hasName && hasPrice) {
      results.push(node);
    }

    for (const value of Object.values(node)) {
      walk(value);
    }
  }

  walk(payload);
  return results;
}

function extractProductId(product) {
  const value = product?.id ?? product?.nmId ?? product?.nmID;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function toWbOffer(source, product, normalizedQuery, sourceUrl) {
  const productId = extractProductId(product);
  const title = product?.name ?? product?.title ?? '';
  const price = normalizePrice(product?.salePriceU ?? product?.priceU ?? product?.price);
  const imageCandidate = toList(product?.image ?? product?.images ?? product?.photos ?? product?.pics)[0];
  const imageUrl = typeof imageCandidate === 'string'
    ? imageCandidate
    : imageCandidate?.big ?? imageCandidate?.c516x688 ?? '';

  const item = {
    source,
    title,
    price,
    image_url: imageUrl,
    product_url: product?.url ?? (productId ? `https://www.wildberries.ru/catalog/${productId}/detail.aspx` : ''),
    features: [product?.brand, product?.subjectName].filter(Boolean),
    currency: 'RUB',
    availability: 'unknown',
    matched_query: normalizedQuery.original,
    normalized_query: normalizedQuery.normalized,
    relevance_score: 0,
    fetched_at: new Date().toISOString(),
    raw_payload: {
      ...product,
      retrieval_mode: 'live_wb_api',
      source_url: sourceUrl,
    },
  };

  item.relevance_score = scoreOffer(normalizedQuery.tokens, item);
  return item;
}

function buildCardsUrl(productIds, dest = '-1257786') {
  const params = new URLSearchParams({
    appType: '1',
    curr: 'rub',
    dest: String(dest),
    spp: '30',
    nm: productIds.join(';'),
  });
  return `https://card.wb.ru/cards/v1/detail?${params.toString()}`;
}

function buildInternalSearchUrl(query, {
  page = 1,
  resultset = 'catalog',
  minPriceU,
  maxPriceU,
  dest = '-1275551',
} = {}) {
  const params = new URLSearchParams({
    ab_testid: 'promo_mask_test_1',
    appType: '1',
    autoselectFilters: 'false',
    curr: 'rub',
    dest: String(dest),
    hide_dtype: '9',
    hide_vflags: '4294967296',
    inheritFilters: 'false',
    lang: 'ru',
    query,
    resultset,
    spp: '30',
    suppressSpellcheck: 'false',
  });

  if (resultset === 'catalog') {
    params.set('page', String(page));
  }
  if (Number.isFinite(minPriceU) && Number.isFinite(maxPriceU) && minPriceU <= maxPriceU) {
    params.set('priceU', `${Math.trunc(minPriceU)};${Math.trunc(maxPriceU)}`);
  }

  return `https://www.wildberries.ru/__internal/u-search/exactmatch/ru/common/v18/search?${params.toString()}`;
}

function extractPriceBounds(payload) {
  const filters = payload?.data?.filters;
  if (!Array.isArray(filters)) return null;

  const priceFilter = filters.find((entry) => entry?.name === 'Цена');
  const minPriceU = Number(priceFilter?.minPriceU);
  const maxPriceU = Number(priceFilter?.maxPriceU);
  if (!Number.isFinite(minPriceU) || !Number.isFinite(maxPriceU) || minPriceU > maxPriceU) {
    return null;
  }
  return { minPriceU: Math.trunc(minPriceU), maxPriceU: Math.trunc(maxPriceU) };
}

function buildPriceRanges(bounds, maxRanges) {
  if (!bounds || !Number.isFinite(maxRanges) || maxRanges < 1) {
    return [null];
  }

  const span = bounds.maxPriceU - bounds.minPriceU;
  if (span <= 0) {
    return [bounds];
  }

  const step = Math.max(100, Math.ceil(span / maxRanges));
  const ranges = [];
  let min = bounds.minPriceU;
  while (min <= bounds.maxPriceU && ranges.length < maxRanges) {
    const max = Math.min(bounds.maxPriceU, min + step);
    ranges.push({ minPriceU: min, maxPriceU: max });
    min = max + 1;
  }
  return ranges.length ? ranges : [null];
}

async function fetchInternalCatalogOffers({
  source,
  normalizedQuery,
  fetchImpl,
  headers,
  attempts,
  limit,
  internalMaxPages,
  internalMaxRanges,
  timeoutMs,
  dest,
}) {
  const filtersUrl = buildInternalSearchUrl(normalizedQuery.normalized, { resultset: 'filters', dest });
  const filtersResponse = await fetchJson(filtersUrl, { fetchImpl, headers, timeoutMs });
  attempts.push(normalizeAttempt('internal_filters', filtersResponse, filtersUrl));

  if (!filtersResponse.ok || filtersResponse.blocked || !filtersResponse.json) {
    return [];
  }

  const ranges = buildPriceRanges(extractPriceBounds(filtersResponse.json), internalMaxRanges);
  const products = [];
  const seen = new Set();

  for (const range of ranges) {
    for (let page = 1; page <= internalMaxPages; page += 1) {
      const catalogUrl = buildInternalSearchUrl(normalizedQuery.normalized, {
        resultset: 'catalog',
        page,
        minPriceU: range?.minPriceU,
        maxPriceU: range?.maxPriceU,
        dest,
      });
      const catalogResponse = await fetchJson(catalogUrl, { fetchImpl, headers, timeoutMs });
      attempts.push(normalizeAttempt('internal_catalog', catalogResponse, catalogUrl));

      if (!catalogResponse.ok || catalogResponse.blocked || !catalogResponse.json) {
        break;
      }

      const current = extractSearchProducts(catalogResponse.json);
      if (!current.length) {
        break;
      }

      for (const product of current) {
        const productId = extractProductId(product);
        const key = productId ?? `${product.name ?? ''}:${product.salePriceU ?? product.price ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        products.push(product);
        if (products.length >= limit) {
          return products;
        }
      }

      const total = Number(catalogResponse.json?.data?.total);
      const maxPage = Number.isFinite(total) && total > 0 ? Math.ceil(total / 100) : 1;
      if (page >= maxPage) {
        break;
      }
    }
  }

  return products;
}

function normalizeAttempt(step, response, endpoint) {
  return {
    step,
    endpoint,
    final_url: response.finalUrl,
    status: response.status,
    blocked: response.blocked,
    ok: response.ok,
    body_length: response.bodyText?.length ?? 0,
    error_name: response.error?.name,
    error_message: response.error?.message,
    error_cause: response.error?.cause?.message,
  };
}

export async function fetchWildberriesOffers({
  source = 'wildberries',
  normalizedQuery,
  fetchImpl = globalThis.fetch,
  token = process.env.WB_X_WBAAS_TOKEN,
  cookie = process.env.WB_COOKIE,
  pow = process.env.WB_X_POW,
  authProviderUrl = process.env.WB_AUTH_PROVIDER_URL,
  authProviderToken = process.env.WB_AUTH_PROVIDER_TOKEN,
  limit = 24,
  timeoutMs = 15000,
  internalFallback = process.env.WB_INTERNAL_FALLBACK !== '0',
  internalMaxPages = 3,
  internalMaxRanges = 6,
  dest,
} = {}) {
  const attempts = [];

  if ((!token && !pow) && authProviderUrl) {
    const providerResponse = await fetchAuthEnvelope(authProviderUrl, {
      fetchImpl,
      bearerToken: authProviderToken,
      timeoutMs,
    });

    attempts.push({
      step: 'auth_provider',
      endpoint: authProviderUrl,
      final_url: providerResponse.finalUrl,
      status: providerResponse.status,
      blocked: providerResponse.status === 403 || providerResponse.status === 429,
      ok: providerResponse.ok,
      body_length: providerResponse.bodyText?.length ?? 0,
      error_name: providerResponse.error?.name,
      error_message: providerResponse.error?.message,
      error_cause: providerResponse.error?.cause?.message,
    });

    if (providerResponse.ok && providerResponse.json && typeof providerResponse.json === 'object') {
      token = providerResponse.json.token || token;
      cookie = providerResponse.json.cookie || cookie;
      pow = providerResponse.json.pow || pow;
    }
  }

  if (!token && !pow) {
    attempts.push({
      step: 'auth',
      endpoint: 'env',
      final_url: '',
      status: 0,
      blocked: true,
      ok: false,
      body_length: 0,
      error_name: 'AuthError',
      error_message: 'Missing WB_X_WBAAS_TOKEN/WB_X_POW and no valid token from WB_AUTH_PROVIDER_URL',
    });

    return {
      offers: [],
      attempts,
      liveHit: false,
    };
  }

  const headers = buildAuthHeaders({ token, cookie, pow });
  const searchUrl = `https://www.wildberries.ru/webapi/search/data?query=${encodeURIComponent(normalizedQuery.normalized)}`;
  const searchResponse = await fetchJson(searchUrl, { fetchImpl, headers, timeoutMs });
  attempts.push(normalizeAttempt('search_api', searchResponse, searchUrl));

  const canUseSearchProducts = searchResponse.ok && !searchResponse.blocked && searchResponse.json;
  const searchProducts = canUseSearchProducts ? extractSearchProducts(searchResponse.json) : [];

  if (!searchProducts.length) {
    if (!internalFallback) {
      return {
        offers: [],
        attempts,
        liveHit: false,
      };
    }

    const internalProducts = await fetchInternalCatalogOffers({
      source,
      normalizedQuery,
      fetchImpl,
      headers,
      attempts,
      limit,
      internalMaxPages,
      internalMaxRanges,
      timeoutMs,
      dest,
    });

    const internalOffers = internalProducts
      .map((product) => toWbOffer(source, product, normalizedQuery, searchResponse.finalUrl))
      .filter((offer) => offer.title && Number.isFinite(offer.price))
      .map((offer) => ({
        ...offer,
        raw_payload: {
          ...offer.raw_payload,
          retrieval_mode: 'live_wb_internal_api',
        },
      }))
      .sort((a, b) => b.relevance_score - a.relevance_score || a.price - b.price);

    return {
      offers: internalOffers,
      attempts,
      liveHit: internalOffers.length > 0,
    };
  }

  const productIds = [...new Set(searchProducts.map((product) => extractProductId(product)).filter(Boolean))].slice(0, limit);

  if (!productIds.length) {
    return {
      offers: [],
      attempts,
      liveHit: false,
    };
  }

  const cardsUrl = buildCardsUrl(productIds, dest ?? undefined);
  const cardsResponse = await fetchJson(cardsUrl, { fetchImpl, headers, timeoutMs });
  attempts.push(normalizeAttempt('cards_api', cardsResponse, cardsUrl));

  const cardProducts = cardsResponse.ok && !cardsResponse.blocked && cardsResponse.json
    ? cardsResponse.json?.data?.products ?? cardsResponse.json?.products
    : null;

  let products = Array.isArray(cardProducts) ? cardProducts : [];
  let retrievalMode = 'live_wb_api';

  if (!products.length && internalFallback) {
    products = await fetchInternalCatalogOffers({
      source,
      normalizedQuery,
      fetchImpl,
      headers,
      attempts,
      limit,
      internalMaxPages,
      internalMaxRanges,
      timeoutMs,
      dest,
    });
    retrievalMode = 'live_wb_internal_api';
  }

  if (!products.length) {
    products = searchProducts;
  }

  const offers = products
    .map((product) => toWbOffer(source, product, normalizedQuery, cardsResponse.finalUrl))
    .filter((offer) => offer.title && Number.isFinite(offer.price))
    .map((offer) => ({
      ...offer,
      raw_payload: {
        ...offer.raw_payload,
        retrieval_mode: retrievalMode,
      },
    }))
    .sort((a, b) => b.relevance_score - a.relevance_score || a.price - b.price);

  return {
    offers,
    attempts,
    liveHit: offers.length > 0,
  };
}
