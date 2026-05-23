import { scoreOffer } from './query.js';

function decodeHtmlEntities(value = '') {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(value = '') {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function headersToObject(headers) {
  if (!headers || typeof headers.entries !== 'function') {
    return {};
  }
  return Object.fromEntries([...headers.entries()].map(([key, value]) => [key.toLowerCase(), String(value)]));
}

function isBlockedResponse(status, html) {
  if ([403, 429].includes(status)) return true;
  return /captcha|forbidden|access denied/i.test(html ?? '');
}

function normalizeImageUrl(url = '') {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

function normalizeAvailability(html = '') {
  const text = html.toLowerCase();
  if (text.includes('schema.org/instock') || text.includes('в наличии')) return 'in_stock';
  if (text.includes('schema.org/outofstock') || text.includes('нет в наличии')) return 'out_of_stock';
  return 'unknown';
}

async function fetchDecodedHtml(url, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
    });

    const contentType = response.headers?.get?.('content-type') ?? '';
    const body = /windows-1251|cp1251/i.test(contentType)
      ? new TextDecoder('windows-1251').decode(await response.arrayBuffer())
      : await response.text();

    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url ?? url,
      bodyText: body,
      blocked: isBlockedResponse(response.status, body),
      headers: headersToObject(response.headers),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      bodyText: '',
      blocked: true,
      headers: {},
      error,
    };
  } finally {
    clearTimeout(timer);
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractDataLayerItems(html) {
  const match = html.match(/dataLayer\s*=\s*(\[[\s\S]*?\]);/i);
  if (!match) {
    return [];
  }

  const data = safeJsonParse(match[1]);
  if (!Array.isArray(data)) {
    return [];
  }

  const impressions = [];
  for (const entry of data) {
    const pageType = entry?.pageType ?? entry?.page_type;
    const list = entry?.ecommerce?.impressions ?? [];
    if (pageType === 'search' && Array.isArray(list)) {
      impressions.push(...list.filter((item) => item && item.id && item.name && Number.isFinite(Number(item.price))));
    }
  }

  const seen = new Set();
  return impressions
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

function extractProductPageDetails(html) {
  const image = normalizeImageUrl(
    html.match(/itemprop=["']image["'][^>]*content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta property=["']og:image:url["'] content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta property=["']og:image["'] content=["']([^"']+)["']/i)?.[1]
      ?? ''
  );
  const title = stripTags(
    html.match(/<meta property=["']og:title["'] content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      ?? ''
  );
  const price = Number(
    html.match(/itemprop=["']price["'][^>]*content=["']([0-9]+(?:\.[0-9]+)?)["']/i)?.[1]
      ?? html.match(/data-layer[^>]*price["']?\s*:\s*([0-9]+)/i)?.[1]
      ?? ''
  );
  const availability = normalizeAvailability(html);

  return {
    title,
    image_url: image,
    price: Number.isFinite(price) ? price : null,
    availability,
  };
}

function buildProductUrl(id) {
  return `https://www.oldi.ru/catalog/element/${id}/`;
}

function buildOfferFromImpression(impression, productDetails, normalizedQuery) {
  const title = productDetails.title || impression.name;
  const price = Number.isFinite(productDetails.price) ? productDetails.price : Number(impression.price);
  return {
    source: 'oldi',
    title,
    price,
    image_url: productDetails.image_url || '',
    product_url: buildProductUrl(impression.id),
    features: [impression.category].filter(Boolean),
    currency: 'RUB',
    availability: productDetails.availability || 'unknown',
    matched_query: normalizedQuery.original,
    normalized_query: normalizedQuery.normalized,
    relevance_score: scoreOffer(normalizedQuery.tokens, {
      title,
      features: [impression.category].filter(Boolean),
      availability: productDetails.availability || 'unknown',
    }),
    fetched_at: new Date().toISOString(),
    raw_payload: {
      source: 'oldi',
      search_result: impression,
      product_page: productDetails,
      retrieval_mode: 'live_oldi',
      source_url: buildProductUrl(impression.id),
    },
  };
}

function buildFallbackOffer(item, normalizedQuery) {
  const title = item.title;
  return {
    source: 'oldi',
    title,
    price: item.price,
    image_url: item.image_url ?? '',
    product_url: item.product_url,
    features: item.features ?? [],
    currency: item.currency ?? 'RUB',
    availability: item.availability ?? 'unknown',
    matched_query: normalizedQuery.original,
    normalized_query: normalizedQuery.normalized,
    relevance_score: scoreOffer(normalizedQuery.tokens, item),
    fetched_at: new Date().toISOString(),
    raw_payload: {
      ...item,
      retrieval_mode: 'fallback',
      source_url: item.product_url,
    },
  };
}

export async function fetchOldiOffers({
  normalizedQuery,
  fetchImpl = globalThis.fetch,
  limit = 10,
  timeoutMs = 15000,
} = {}) {
  const attempts = [];
  const searchUrl = `https://www.oldi.ru/search/?q=${encodeURIComponent(normalizedQuery.normalized)}`;
  const searchResponse = await fetchDecodedHtml(searchUrl, { fetchImpl, timeoutMs });

  attempts.push({
    step: 'search_page',
    endpoint: searchUrl,
    final_url: searchResponse.finalUrl,
    status: searchResponse.status,
    blocked: searchResponse.blocked,
    ok: searchResponse.ok,
    body_length: searchResponse.bodyText?.length ?? 0,
    error_name: searchResponse.error?.name,
    error_message: searchResponse.error?.message,
    error_cause: searchResponse.error?.cause?.message,
  });

  if (!searchResponse.ok || searchResponse.blocked || !searchResponse.bodyText) {
    return { offers: [], attempts, liveHit: false };
  }

  const impressions = extractDataLayerItems(searchResponse.bodyText).slice(0, limit);
  if (!impressions.length) {
    return { offers: [], attempts, liveHit: false };
  }

  const offers = [];
  for (const impression of impressions) {
    const productUrl = buildProductUrl(impression.id);
    const pageResponse = await fetchDecodedHtml(productUrl, { fetchImpl, timeoutMs });
    attempts.push({
      step: 'product_page',
      endpoint: productUrl,
      final_url: pageResponse.finalUrl,
      status: pageResponse.status,
      blocked: pageResponse.blocked,
      ok: pageResponse.ok,
      body_length: pageResponse.bodyText?.length ?? 0,
      error_name: pageResponse.error?.name,
      error_message: pageResponse.error?.message,
      error_cause: pageResponse.error?.cause?.message,
    });

    const details = pageResponse.ok && !pageResponse.blocked && pageResponse.bodyText
      ? extractProductPageDetails(pageResponse.bodyText)
      : { title: '', image_url: '', price: null, availability: 'unknown' };

    offers.push(buildOfferFromImpression(impression, details, normalizedQuery));
    if (offers.length >= limit) break;
  }

  return {
    offers: offers.sort((a, b) => b.relevance_score - a.relevance_score || a.price - b.price),
    attempts,
    liveHit: offers.length > 0,
  };
}

export function buildOldiFallbackOffers(normalizedQuery, items) {
  return items
    .map((item) => buildFallbackOffer(item, normalizedQuery))
    .filter((offer) => offer.relevance_score >= 20)
    .sort((a, b) => b.relevance_score - a.relevance_score || a.price - b.price);
}
