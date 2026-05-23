// Fetches technical specifications from individual product pages.
// Called after list-scraping to enrich top results with full characteristics.
// Returns a flat array of { key, value } pairs for inclusion in offer.features.

import * as sb from './stealth-browser.js';

// ─── WB ──────────────────────────────────────────────────────────────────────
// WB specs: th.cellKey--eGe6N + td.cellValue--hHBJB pairs inside table.table--CGApj
// Single-line — multiline scripts with backslashes cause 500 in stealth browser.
const WB_SPECS_EXTRACT = "(() => { const out = {}; for (const tr of document.querySelectorAll('table[class*=\"table\"] tr')) { const th = tr.querySelector('th[class*=\"cellKey\"]'); const td = tr.querySelector('td[class*=\"cellValue\"]'); if (!th || !td) continue; const k = th.textContent.trim(); const v = td.textContent.trim(); if (k && v && k.length < 80 && v.length < 200) out[k] = v; } return JSON.stringify(out); })()";

// ─── OZON ────────────────────────────────────────────────────────────────────
// Ozon: dl/dt/dd pairs inside [data-widget="webCharacteristics"], fallback to all dl.
// Single-line — multiline scripts with backslashes cause 500 in stealth browser.
const OZON_SPECS_EXTRACT = "(() => { const out = {}; const w = document.querySelector('[data-widget=\"webCharacteristics\"]'); const root = w || document; for (const dl of root.querySelectorAll('dl')) { const dts = dl.querySelectorAll('dt'); const dds = dl.querySelectorAll('dd'); for (let i = 0; i < dts.length && i < dds.length; i++) { const k = dts[i].textContent.trim(); const v = dds[i].textContent.trim(); if (k && v && k.length < 80) out[k] = v; } } return JSON.stringify(out); })()";

// ─── YANDEX MARKET ───────────────────────────────────────────────────────────
// product-spec elements are labels; value is in children[1] of the grandparent pair div.
// Must be a single-line string — multiline scripts with backslashes cause 500 in stealth browser.
const YM_SPECS_EXTRACT = "(() => { const out = {}; for (const el of document.querySelectorAll('[data-auto=\\'product-spec\\']')) { const pair = el.parentElement && el.parentElement.parentElement && el.parentElement.parentElement.parentElement; if (pair && pair.children.length >= 2) { const k = el.textContent.trim(); const v = pair.children[1].textContent.trim(); if (k && v) out[k] = v; } } return JSON.stringify(out); })()";

// ─── CORE ────────────────────────────────────────────────────────────────────

function specsToFeatures(raw) {
  if (!raw || typeof raw !== 'string') return [];
  let obj;
  try { obj = JSON.parse(raw); } catch { return []; }
  return Object.entries(obj)
    .filter(([, v]) => v && String(v).length < 200)
    .map(([k, v]) => `${k}: ${v}`);
}

const SOURCE_SCRIPT = {
  ozon: OZON_SPECS_EXTRACT,
  yandex_market: YM_SPECS_EXTRACT,
  wildberries: WB_SPECS_EXTRACT,
};

const SOURCE_SETTLE = {
  ozon: 6000,
  yandex_market: 8000,
  wildberries: 10000,
};

// Extracts key characteristics from a WB product title string.
// Used as fallback when card.wb.ru API is blocked (403 on datacenter IPs).
function extractFeaturesFromTitle(title) {
  if (!title) return [];
  const out = [];
  const t = title;

  // Мощность: 1500 Вт / 1.5кВт
  const power = t.match(/(\d[\d.,]*)\s*(кВт|вт|Вт|W\b)/i);
  if (power) out.push(`Мощность: ${power[1]} ${power[2]}`);

  // Давление: 15 бар / 19bar
  const pressure = t.match(/(\d+)\s*(бар|bar)\b/i);
  if (pressure) out.push(`Давление: ${pressure[1]} ${pressure[2]}`);

  // Объём: 1.5 л / 1500 мл
  const vol = t.match(/(\d[\d.,]*)\s*(л\b|литр|мл\b|ml\b)/i);
  if (vol) out.push(`Объём: ${vol[1]} ${vol[2]}`);

  // Тип: рожковая / капсульная / зерновая / автоматическая / полуавтоматическая
  const types = ['рожковая', 'капсульная', 'зерновая', 'автоматическая', 'полуавтоматическая', 'капельная', 'гейзерная'];
  for (const tp of types) {
    if (t.toLowerCase().includes(tp)) { out.push(`Тип: ${tp}`); break; }
  }

  // Капучинатор
  if (/капучинатор/i.test(t)) out.push('Капучинатор: да');

  // Кофемолка
  if (/кофемолк/i.test(t)) out.push('Встроенная кофемолка: да');

  // Количество в 1 (например 11в1)
  const combo = t.match(/(\d+)\s*в\s*1/i);
  if (combo) out.push(`Функций: ${combo[1]} в 1`);

  // Модель (артикул из заглавных букв+цифр, например CT-1160, TCM03EA)
  const model = t.match(/\b([A-Z]{1,4}[-\s]?\d{3,6}[A-Z]{0,4})\b/);
  if (model) out.push(`Модель: ${model[1]}`);

  return out;
}

async function fetchWbSpecsApi(productUrl) {
  const m = productUrl.match(/\/catalog\/(\d+)\//);
  if (!m) return [];
  const nmId = m[1];
  try {
    const resp = await fetch(`https://card.wb.ru/cards/v2/detail?appType=1&curr=rub&dest=-1257786&nm=${nmId}`, {
      headers: {
        'Accept': '*/*',
        'Accept-Language': 'ru-RU,ru;q=0.9',
        'Origin': 'https://www.wildberries.ru',
        'Referer': 'https://www.wildberries.ru/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    });
    if (!resp.ok) return [];
    const j = await resp.json();
    const product = j?.data?.products?.[0];
    if (!product) return [];
    const out = [];
    if (product.brand) out.push(`Бренд: ${product.brand}`);
    if (product.subjectName) out.push(`Категория: ${product.subjectName}`);
    for (const opt of product.options ?? []) {
      if (opt.name && opt.value) out.push(`${opt.name}: ${opt.value}`);
    }
    for (const p of product.params ?? []) {
      if (p.name && p.value) out.push(`${p.name}: ${p.value}`);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Fetches specs for a single product URL.
 * WB: via card.wb.ru API. Ozon/YM: via stealth browser DOM extraction.
 * Returns an array of "Key: Value" feature strings, or [] on failure.
 */
async function fetchSpecsStealth(source, productUrl, { timeoutMs = 45000, title = '' } = {}) {
  if (!productUrl) return [];
  const script = SOURCE_SCRIPT[source];
  if (!script) return [];
  let tabId = null;
  try {
    tabId = await sb.openTab(productUrl, { sessionKey: `${source}_specs`, timeoutMs });
    await sb.waitMs(tabId, SOURCE_SETTLE[source] ?? 6000, { timeoutMs });
    const raw = await sb.evaluate(tabId, script, { timeoutMs });
    const specs = specsToFeatures(raw);
    if (specs.length > 0) return specs;
  } catch {
    // fall through to API/title fallbacks
  } finally {
    if (tabId) await sb.closeTab(tabId).catch(() => {});
  }
  if (source === 'wildberries') {
    const api = await fetchWbSpecsApi(productUrl);
    if (api.length > 0) return api;
    return extractFeaturesFromTitle(title);
  }
  return [];
}

/**
 * Enriches the top-N offers with specs fetched from their product pages.
 * Mutates offers[i].features in place; returns the same array.
 * topN: how many offers to enrich (rest keep list-scrape features).
 */
async function enrichOffersWithSpecs(offers, { topN = 5, timeoutMs = 45000 } = {}) {
  const toEnrich = offers.slice(0, topN).filter((o) => o.product_url);
  await Promise.allSettled(
    toEnrich.map(async (offer) => {
      const specs = await fetchSpecsStealth(offer.source, offer.product_url, { timeoutMs, title: offer.title ?? '' });
      if (specs.length > 0) {
        // Merge: keep existing features (brand/category from list), append specs
        const existing = new Set(offer.features ?? []);
        for (const s of specs) {
          if (!existing.has(s)) offer.features.push(s);
        }
      }
    }),
  );
  return offers;
}

export { fetchSpecsStealth, enrichOffersWithSpecs, specsToFeatures, extractFeaturesFromTitle };
