// Stealth-browser scrapers for Wildberries, Ozon and Yandex Market.
// Routes through a sandboxed anti-detect Firefox instance (see stealth-browser.js).
// If the service is unreachable, callers in catalog.js fall back to the HTTP path.

import * as sb from './stealth-browser.js';
import {
  toOffer,
} from './playwright-scraper.js';
import { enrichOffersWithSpecs } from './item-details.js';
import { parseDeliveryText } from './delivery-date.js';
import {
  applyMarketplaceRegion,
  withWildberriesRegion,
  withYandexMarketRegion,
} from './marketplace-region.js';

const BLOCK_MARKERS = ['доступ ограничен', 'captcha', 'вы не робот', 'access denied', 'проверка', 'using a vpn', 'are you a robot'];

function looksBlocked(title) {
  const t = (title ?? '').toLowerCase();
  return BLOCK_MARKERS.some((m) => t.includes(m));
}

// ─── OZON ────────────────────────────────────────────────────────────────────
// Reads product tiles from the rendered DOM. We scroll twice after initial load
// so lazy-loaded cards below the fold are present before extraction.
// Each /product/ link is walked up to an ancestor that holds a "₽" price;
// title = longest non-badge text node in that tile. Delivery text is picked from
// any descendant mentioning a delivery/date keyword.
const OZON_DOM_EXTRACT = `(() => {
  const out = [], seen = new Set();
  const deliveryRe = /(сегодня|послезавтра|завтра|\\d{1,2}\\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))/i;
  for (const a of document.querySelectorAll('a[href*="/product/"]')) {
    const m = (a.getAttribute('href') || '').match(/\\/product\\/[^?#]+/);
    if (!m || seen.has(m[0])) continue;
    let box = a;
    for (let i = 0; i < 5 && box; i++) { if (/₽/.test(box.textContent || '')) break; box = box.parentElement; }
    if (!box) continue;
    const priceM = (box.textContent || '').replace(/\\s+/g, ' ').match(/([\\d ]{2,})₽/);
    if (!priceM) continue;
    const texts = [...box.querySelectorAll('span, a')]
      .map((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter((t) => t.length > 12 && !/₽/.test(t));
    const title = texts.sort((x, y) => y.length - x.length)[0] || (a.textContent || '').trim();
    if (!title) continue;
    const img = box.querySelector('img');
    const image_url = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';
    const deliveryEl = [...box.querySelectorAll('span, div')]
      .map((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim())
      .find((t) => t.length > 0 && t.length < 200 && deliveryRe.test(t));
    seen.add(m[0]);
    out.push({ title: title.slice(0, 120), price: priceM[1].replace(/\\s/g, ''), url: 'https://www.ozon.ru' + m[0], image_url, delivery_text: deliveryEl || '' });
  }
  return JSON.stringify(out);
})()`;

function tileToItem(tile) {
  const price = Number(tile.price);
  if (!tile.title || !Number.isFinite(price) || price <= 0) return null;
  return {
    title: tile.title,
    price,
    image_url: tile.image_url ?? '',
    product_url: tile.url ?? '',
    features: [],
    availability: 'unknown',
    delivery_text: tile.delivery_text ?? '',
  };
}

async function extractOzonItems(tabId, timeoutMs) {
  // Two scroll passes + short settle to load lazy cards below the fold.
  await sb.scroll(tabId, { amount: 1200, timeoutMs });
  await sb.waitMs(tabId, 1500, { timeoutMs });
  await sb.scroll(tabId, { amount: 1200, timeoutMs });
  await sb.waitMs(tabId, 1500, { timeoutMs });

  const raw = await sb.evaluate(tabId, OZON_DOM_EXTRACT, { timeoutMs });
  let tiles = [];
  try { tiles = JSON.parse(typeof raw === 'string' ? raw : '[]'); } catch { /* ignore */ }
  return tiles.map(tileToItem).filter(Boolean);
}

// ─── WILDBERRIES ─────────────────────────────────────────────────────────────
// WB renders product cards via SPA after a JS challenge. settleMs = 12s gives
// the challenge time to complete; DOM extraction mirrors the Ozon approach.
const WB_DOM_EXTRACT = `(() => {
  const out = [], seen = new Set();
  const deliveryRe = /(сегодня|послезавтра|завтра|\\d{1,2}\\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))/i;
  for (const a of document.querySelectorAll('a[href*="/detail.aspx"], a[href*="/catalog/"][href*="/detail"]')) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\\/catalog\\/(\\d+)\\/detail/);
    if (!m || seen.has(m[1])) continue;
    let box = a;
    for (let i = 0; i < 6 && box; i++) { if (/₽/.test(box.textContent || '')) break; box = box.parentElement; }
    if (!box) continue;
    const priceM = (box.textContent || '').replace(/\\s+/g, ' ').match(/([\\d ]{2,})₽/);
    if (!priceM) continue;
    const texts = [...box.querySelectorAll('span, a, p')]
      .map((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter((t) => t.length > 8 && !/₽/.test(t));
    const title = texts.sort((x, y) => y.length - x.length)[0] || (a.textContent || '').trim();
    if (!title) continue;
    const img = box.querySelector('img');
    const image_url = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';
    const deliveryEl = [...box.querySelectorAll('span, div')]
      .map((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim())
      .find((t) => t.length > 0 && t.length < 200 && deliveryRe.test(t));
    seen.add(m[1]);
    out.push({ title: title.slice(0, 120), price: priceM[1].replace(/\\s/g, ''), url: 'https://www.wildberries.ru/catalog/' + m[1] + '/detail.aspx', image_url, delivery_text: deliveryEl || '' });
  }
  return JSON.stringify(out);
})()`;

async function extractWbItems(tabId, timeoutMs) {
  const raw = await sb.evaluate(tabId, WB_DOM_EXTRACT, { timeoutMs });
  let tiles = [];
  try { tiles = JSON.parse(typeof raw === 'string' ? raw : '[]'); } catch { /* ignore */ }
  return tiles.map(tileToItem).filter(Boolean);
}

// ─── YANDEX MARKET ───────────────────────────────────────────────────────────
// YM lazy-renders snippets. The title node nests a brand label + name as separate
// text nodes, so we join leaf text with a space. Price lives in either
// snippet-price-current or a visually-hidden "Цена ... NN ₽" node. Delivery date
// is read from a delivery-flagged node or any node mentioning a date keyword.
const YM_DOM_EXTRACT = `(() => {
  const out = [];
  const seen = new Set();
  const deliveryRe = /(сегодня|послезавтра|завтра|\\d{1,2}\\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))/i;
  for (const a of document.querySelectorAll('article')) {
    const titleEl = a.querySelector('[data-auto="snippet-title"]');
    if (!titleEl) continue;
    const parts = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { const t = c.textContent.trim(); if (t) parts.push(t); }
        else if (c.nodeType === 1) walk(c);
      }
    };
    walk(titleEl);
    const title = [...new Set(parts)].join(' ').replace(/\\s+/g, ' ').trim();
    if (!title) continue;
    let priceText = a.querySelector('[data-auto="snippet-price-current"]')?.textContent?.trim() ?? '';
    if (!/\\d/.test(priceText)) {
      const hidden = [...a.querySelectorAll('*')].find((e) => e.children.length === 0 && /\\d[\\d\\s]*₽/.test(e.textContent));
      priceText = hidden?.textContent ?? '';
    }
    const priceM = priceText.replace(/[\\s\\u00a0]/g, '').match(/(\\d{2,})/);
    if (!priceM) continue;
    let url = a.querySelector('a[href*="/card/"]')?.getAttribute('href')
      ?? a.querySelector('a[href*="/product"]')?.getAttribute('href') ?? '';
    if (url && url.startsWith('/')) url = 'https://market.yandex.ru' + url;
    const img = a.querySelector('img');
    const image_url = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';
    const deliveryCandidates = [...a.querySelectorAll('[data-auto*="delivery"], [class*="delivery"], [class*="Delivery"], span, div')]
      .map((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter((t) => t.length > 0 && t.length < 360 && /(достав|получ|самовывоз|пункт|курьер|склад|отправ|сегодня|завтра|послезавтра)/i.test(t));
    const deliveryEl = deliveryCandidates.find((t) => /(склад|отправ)/i.test(t) && deliveryRe.test(t))
      || deliveryCandidates.find((t) => deliveryRe.test(t));
    const deliveryM = deliveryEl?.match(deliveryRe) ?? (a.textContent || '').match(deliveryRe);
    const delivery_text = deliveryEl || deliveryM?.[0] || '';
    const key = title + ':' + priceM[1];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: title.slice(0, 120), price: priceM[1], url, image_url, delivery_text });
  }
  return JSON.stringify(out);
})()`;

async function extractYmItems(tabId, timeoutMs) {
  // YM virtualizes the result list — scroll to force lazy snippets to render.
  for (let i = 0; i < 4; i += 1) {
    await sb.scroll(tabId, { amount: 1500, timeoutMs: 15000 }).catch(() => {});
    await sb.waitMs(tabId, 1200, { timeoutMs }).catch(() => {});
  }
  const raw = await sb.evaluate(tabId, YM_DOM_EXTRACT, { timeoutMs });
  let tiles = [];
  try { tiles = JSON.parse(typeof raw === 'string' ? raw : '[]'); } catch { /* ignore */ }
  return tiles.map(tileToItem).filter(Boolean);
}

// Lift delivery text off the parsed item onto the offer, deriving days/date/origin
// when the text contains a parseable RU date. No deadline filtering — informational.
function attachDelivery(offer, item) {
  const text = item.delivery_text ?? '';
  if (text) offer.delivery_text = text;
  const info = parseDeliveryText(text);
  if (info) {
    offer.delivery_days = info.days;
    offer.delivery_date = info.dateIso;
    if (info.shipmentOriginCity) offer.shipment_origin_city = info.shipmentOriginCity;
  }
  return offer;
}

// ─── CORE ────────────────────────────────────────────────────────────────────
async function scrapeViaStealth({ source, searchUrl, extractItems, normalizedQuery, limit, retrievalMode, timeoutMs, settleMs = 6000, enrichSpecs = false, specsTopN = 5, geo }) {
  const attempts = [];
  let tabId = null;
  try {
    tabId = await sb.openTab(searchUrl, { sessionKey: source, timeoutMs });
    attempts.push({ step: 'open_tab', endpoint: searchUrl, blocked: false, ok: true });

    const region = await applyMarketplaceRegion(tabId, source, geo, { searchUrl, timeoutMs });
    if (region.applied) {
      attempts.push({ step: 'region_session', endpoint: searchUrl, blocked: false, ok: true });
    }

    await sb.waitMs(tabId, settleMs, { timeoutMs });

    const title = await sb.evaluate(tabId, 'document.title', { timeoutMs }).catch(() => '');
    const blocked = looksBlocked(title);

    const items = blocked ? [] : await extractItems(tabId, timeoutMs);
    attempts.push({
      step: 'extract',
      endpoint: searchUrl,
      status: 200,
      blocked: blocked || items.length === 0,
      ok: items.length > 0,
      error_message: blocked ? `interstitial: ${title}`.slice(0, 80) : undefined,
    });

    const seen = new Set();
    const offers = [];
    for (const item of items) {
      if (!item) continue;
      const key = item.title + ':' + item.price;
      if (seen.has(key)) continue;
      seen.add(key);
      offers.push(attachDelivery(toOffer(source, item, normalizedQuery, retrievalMode), item));
      if (offers.length >= limit) break;
    }
    const sorted = offers.sort((a, b) => b.relevance_score - a.relevance_score || a.price - b.price);
    if (enrichSpecs && sorted.length > 0) {
      await enrichOffersWithSpecs(sorted, { topN: specsTopN, timeoutMs });
    }
    return { offers: sorted, attempts, liveHit: sorted.length > 0 };
  } catch (err) {
    attempts.push({ step: 'stealth', blocked: true, error_message: err.message });
    return { offers: [], attempts, liveHit: false };
  } finally {
    if (tabId) await sb.closeTab(tabId);
  }
}

function scrapeWildberriesStealth({ normalizedQuery, limit = 20, timeoutMs = 60000, enrichSpecs = false, specsTopN = 5, geo } = {}) {
  const searchUrl = withWildberriesRegion(
    `https://www.wildberries.ru/catalog/0/search.aspx?search=${encodeURIComponent(normalizedQuery.original)}`,
    geo,
  );
  return scrapeViaStealth({
    source: 'wildberries',
    geo,
    searchUrl,
    extractItems: extractWbItems,
    normalizedQuery,
    limit,
    retrievalMode: 'live_wb_stealth',
    settleMs: 12000,
    timeoutMs,
    enrichSpecs,
    specsTopN,
  });
}

function scrapeOzonStealth({ normalizedQuery, limit = 20, timeoutMs = 60000, enrichSpecs = false, specsTopN = 5, geo } = {}) {
  return scrapeViaStealth({
    source: 'ozon',
    geo,
    searchUrl: `https://www.ozon.ru/search/?text=${encodeURIComponent(normalizedQuery.original)}&from_global=true`,
    extractItems: extractOzonItems,
    normalizedQuery,
    limit,
    retrievalMode: 'live_ozon_stealth',
    timeoutMs,
    enrichSpecs,
    specsTopN,
  });
}

const YM_RS_TOKEN = 'eJwzEv_EKMLBKLDwEKsEg8azbh6NVUdYNT6fYQUAWiMIFg,,';

function scrapeYandexMarketStealth({ normalizedQuery, limit = 20, timeoutMs = 60000, enrichSpecs = false, specsTopN = 5, geo } = {}) {
  const searchUrl = withYandexMarketRegion(
    `https://market.yandex.ru/search?text=${encodeURIComponent(normalizedQuery.original)}&rs=${encodeURIComponent(YM_RS_TOKEN)}`,
    geo,
  );
  return scrapeViaStealth({
    source: 'yandex_market',
    geo,
    searchUrl,
    extractItems: extractYmItems,
    normalizedQuery,
    limit,
    retrievalMode: 'live_ym_stealth',
    timeoutMs,
    enrichSpecs,
    specsTopN,
  });
}

export { scrapeOzonStealth, scrapeYandexMarketStealth, scrapeWildberriesStealth };
