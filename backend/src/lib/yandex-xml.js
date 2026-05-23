import { fetchAndParseOffers } from './product-pages.js';

function decodeXmlEntities(value = '') {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(value = '') {
  return decodeXmlEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function readTag(xml, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xml.match(pattern);
  return match ? stripTags(match[1]) : '';
}

function readTags(xml, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const values = [];
  let match;
  while ((match = pattern.exec(xml))) {
    values.push(stripTags(match[1]));
  }
  return values;
}

function headersToObject(headers) {
  if (!headers || typeof headers.entries !== 'function') {
    return {};
  }
  return Object.fromEntries([...headers.entries()].map(([key, value]) => [key.toLowerCase(), String(value)]));
}

function isBlockedXmlResponse(status, bodyText, headerMap) {
  if ([403, 429].includes(status)) return true;
  if (headerMap['x-captcha'] || headerMap['x-blocked']) return true;
  return /captcha|forbidden|access denied|робот/i.test(bodyText ?? '');
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

function isValidUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractPriceFromText(text) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ');
  const match = normalized.match(/(?:₽|руб\.?|rur)\s*([0-9][0-9\s]{1,})/i)
    ?? normalized.match(/([0-9][0-9\s]{2,})\s*(?:₽|руб\.?|rur)/i);
  if (!match) return null;
  const digits = match[1].replace(/\s+/g, '');
  const price = Number(digits);
  return Number.isFinite(price) ? price : null;
}

async function fetchXml(url, { fetchImpl, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        accept: 'application/xml,text/xml,*/*',
        'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
    });

    const bodyText = await response.text();
    const headerMap = headersToObject(response.headers);
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url ?? url,
      bodyText,
      blocked: isBlockedXmlResponse(response.status, bodyText, headerMap),
      headerMap,
      json: safeJsonParse(bodyText),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      bodyText: '',
      blocked: true,
      headerMap: {},
      json: null,
      error,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function extractYandexXmlDocs(xmlText) {
  const docs = [];
  const docPattern = /<doc\b[^>]*>([\s\S]*?)<\/doc>/gi;
  let match;

  while ((match = docPattern.exec(xmlText))) {
    const block = match[1];
    const url = readTag(block, 'url') || readTag(block, 'saved-copy-url');
    if (!isValidUrl(url)) continue;

    docs.push({
      url,
      title: readTag(block, 'title'),
      headline: readTag(block, 'headline'),
      passages: readTags(block, 'passage'),
    });

    if (docs.length >= 10) {
      break;
    }
  }

  return docs;
}

function buildYandexXmlUrl({
  domain = 'ru',
  user,
  key,
  query,
  lr = '213',
  l10n = 'ru',
  page = 0,
  groupsOnPage = 10,
  docsInGroup = 1,
}) {
  const params = new URLSearchParams({
    user,
    key,
    query,
    lr: String(lr),
    l10n,
    sortby: 'rlv',
    filter: 'none',
    maxpassages: '1',
    groupby: `attr=d.mode=deep.groups-on-page=${groupsOnPage}.docs-in-group=${docsInGroup}`,
    page: String(page),
  });

  return `https://yandex.${domain}/search/xml?${params.toString()}`;
}

export async function fetchYandexXmlOffers({
  source = 'yandex_xml',
  normalizedQuery,
  fetchImpl = globalThis.fetch,
  user = process.env.YANDEX_XML_USER,
  key = process.env.YANDEX_XML_KEY,
  domain = process.env.YANDEX_XML_DOMAIN ?? 'ru',
  lr = process.env.YANDEX_XML_LR ?? '213',
  l10n = process.env.YANDEX_XML_L10N ?? 'ru',
  limit = 10,
} = {}) {
  const attempts = [];

  if (!user || !key) {
    attempts.push({
      step: 'auth',
      endpoint: 'env',
      final_url: '',
      status: 0,
      blocked: true,
      ok: false,
      body_length: 0,
      error_name: 'AuthError',
      error_message: 'Missing YANDEX_XML_USER/YANDEX_XML_KEY',
    });

    return {
      offers: [],
      attempts,
      liveHit: false,
    };
  }

  const searchUrl = buildYandexXmlUrl({
    domain,
    user,
    key,
    query: normalizedQuery.normalized,
    lr,
    l10n,
    page: 0,
    groupsOnPage: Math.max(1, Math.min(10, limit)),
    docsInGroup: 1,
  });

  const xmlResponse = await fetchXml(searchUrl, { fetchImpl });
  attempts.push(normalizeAttempt('xml_search', xmlResponse, searchUrl));

  if (!xmlResponse.ok || xmlResponse.blocked || !xmlResponse.bodyText) {
    return {
      offers: [],
      attempts,
      liveHit: false,
    };
  }

  const docs = extractYandexXmlDocs(xmlResponse.bodyText);
  const urls = [...new Set(docs.map((doc) => doc.url))].slice(0, limit);
  if (!urls.length) {
    return {
      offers: [],
      attempts,
      liveHit: false,
    };
  }

  const pageResult = await fetchAndParseOffers({
    source,
    normalizedQuery,
    urls,
    fetchImpl,
    collectAll: true,
    retrievalMode: 'live_yandex_xml',
  });

  const snippetOffers = pageResult.offers.length > 0
    ? []
    : docs
        .map((doc) => {
          const text = [doc.title, doc.headline, ...(doc.passages ?? [])].filter(Boolean).join(' ');
          const price = extractPriceFromText(text);
          if (!doc.title || !Number.isFinite(price)) {
            return null;
          }

          return {
            source,
            title: doc.title,
            price,
            image_url: '',
            product_url: doc.url,
            features: doc.headline ? [doc.headline] : [],
            currency: 'RUB',
            availability: 'unknown',
            matched_query: normalizedQuery.original,
            normalized_query: normalizedQuery.normalized,
            relevance_score: 40,
            fetched_at: new Date().toISOString(),
            raw_payload: {
              title: doc.title,
              headline: doc.headline,
              passages: doc.passages,
              url: doc.url,
              retrieval_mode: 'live_yandex_xml_snippet',
              source_url: xmlResponse.finalUrl,
            },
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.relevance_score - a.relevance_score || a.price - b.price)
        .slice(0, limit);

  return {
    offers: pageResult.offers.length > 0 ? pageResult.offers : snippetOffers,
    attempts: [...attempts, ...pageResult.attempts],
    liveHit: pageResult.liveHit || snippetOffers.length > 0,
  };
}

