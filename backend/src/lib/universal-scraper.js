// Universal 4th-source scraper.
// Searches Bing for the query, finds product pages on shops (not articles/reviews),
// extracts specs via stealth-browser or Playwright fallback.

import * as sb from './stealth-browser.js';
import { scoreOffer } from './query.js';

const SKIP_DOMAINS = new Set([
  'wildberries.ru', 'wb.ru',
  'ozon.ru',
  'market.yandex.ru', 'yandex.ru',
  'avito.ru',
  'youtube.com', 'wikipedia.org', 'vk.com', 'ok.ru',
  'vc.ru', 'pikabu.ru', 'habr.com', 'dzen.ru', 'zen.yandex.ru',
  'kp.ru', 'mail.ru', 'hi-tech.mail.ru', 'rg.ru', 'kommersant.ru', 'forbes.ru', 'rbk.ru', 'tass.ru',
]);

// URL path patterns that indicate a product/catalog page (not article/blog)
const PRODUCT_PATH_RE = /\/(product|tovar|item|good|p\/|detail|buy|card|offers?)\//i;
// URL path patterns that indicate articles/reviews — skip these
const ARTICLE_PATH_RE = /\/(blog|article|news|rating|reyting|review|obzor|post|stati|top|luchsh|reiting|best|vybor|ocenk|sravneni)/i;
// Domains that look like review/comparison sites — skip
const REVIEW_DOMAIN_RE = /^(vyboroved|markakachestva|yapokupayu|expertoved|luchshiy|top10|ratings?|reting|obzor|ichoos|etobestov|vsevtope|expertchoice)/i;

const PAGE_SETTLE = 2500;

const IS_BLOCKED = "(() => { const t = document.title || ''; const b = document.body?.innerText || ''; return JSON.stringify(/403|Access Denied|Forbidden|Robot Check|Enable JavaScript|Just a moment/i.test(t) || b.length < 300); })()";


// Extracts product links from a catalog/category page
const EXTRACT_PRODUCT_LINKS = "(() => { const links = []; for (const a of document.querySelectorAll('a[href]')) { const h = a.href; if (!h || h.length > 300) continue; try { const u = new URL(h); if (u.origin !== location.origin) continue; const p = u.pathname; if (/\\.(jpg|png|gif|pdf|zip|css|js)$/i.test(p)) continue; if (/\\/(cart|basket|login|register|account|search|compare|wishlist|favor)/i.test(p)) continue; links.push(h); } catch {} } return JSON.stringify([...new Set(links)].slice(0, 30)); })()";

// Structured-only extractor: pulls Product data ONLY from JSON-LD and Microdata.
// Returns { title, image, price, specs:{}, found:bool }. If found=false, the page
// has no machine-readable Product structure and should be skipped.
const STRUCTURED_EXTRACT = "(() => {\n"
  + "  const res = { title: '', image: '', price: '', specs: {}, found: false };\n"
  + "  const addSpec = (k, v) => { if (k == null || v == null) return; const rawK = String(k); const rawV = String(v); k = rawK.replace(/\\s+/g, ' ').replace(/[:\\s]+$/, '').trim(); v = rawV.replace(/\\s+/g, ' ').trim(); if ((rawK.match(/:/g) || []).length >= 2 || (rawV.match(/:/g) || []).length >= 2) return; if (!k || !v || k.length >= 80 || v.length >= 200 || k === v) return; if (Object.keys(res.specs).length >= 60 || res.specs[k]) return; res.specs[k] = v; };\n"
  + "  const firstStr = x => Array.isArray(x) ? firstStr(x[0]) : (x && typeof x === 'object' ? (x.url || x.name || x['@id'] || '') : (x == null ? '' : String(x)));\n"
  + "  const flatten = node => { let out = []; if (Array.isArray(node)) { for (const n of node) out = out.concat(flatten(n)); } else if (node && typeof node === 'object') { out.push(node); if (node['@graph']) out = out.concat(flatten(node['@graph'])); } return out; };\n"
  + "  const isProductType = t => { if (!t) return false; const arr = Array.isArray(t) ? t : [t]; return arr.some(x => String(x).toLowerCase().includes('product')); };\n"
  + "  const handleProduct = p => {\n"
  + "    res.found = true;\n"
  + "    if (!res.title && p.name) res.title = firstStr(p.name);\n"
  + "    if (!res.image && p.image) res.image = firstStr(p.image);\n"
  + "    let offers = p.offers; if (Array.isArray(offers)) offers = offers[0];\n"
  + "    if (!res.price && offers && offers.price) res.price = String(offers.price);\n"
  + "    if (!res.price && p.price) res.price = String(p.price);\n"
  + "    let props = p.additionalProperty || []; if (!Array.isArray(props)) props = [props];\n"
  + "    for (const pr of props) { if (pr && pr.name != null) addSpec(pr.name, pr.value != null ? pr.value : pr.unitText); }\n"
  + "  };\n"
  + "  for (const s of document.querySelectorAll('script[type=\\\"application/ld+json\\\"]')) {\n"
  + "    let parsed; try { parsed = JSON.parse(s.textContent); } catch { continue; }\n"
  + "    for (const node of flatten(parsed)) { if (isProductType(node['@type'])) handleProduct(node); }\n"
  + "  }\n"
  + "  const scope = document.querySelector('[itemtype*=\\\"schema.org/Product\\\" i]');\n"
  + "  if (scope) {\n"
  + "    res.found = true;\n"
  + "    if (!res.title) { const n = scope.querySelector('[itemprop=\\\"name\\\"]'); if (n) res.title = (n.getAttribute('content') || n.textContent || '').trim(); }\n"
  + "    if (!res.image) { const im = scope.querySelector('[itemprop=\\\"image\\\"]'); if (im) res.image = (im.getAttribute('content') || im.getAttribute('src') || '').trim(); }\n"
  + "    if (!res.price) { const pr = scope.querySelector('[itemprop=\\\"price\\\"]'); if (pr) res.price = (pr.getAttribute('content') || pr.textContent || '').trim(); }\n"
  + "    for (const ap of scope.querySelectorAll('[itemprop=\\\"additionalProperty\\\"]')) { const n = ap.querySelector('[itemprop=\\\"name\\\"]'); const v = ap.querySelector('[itemprop=\\\"value\\\"]'); if (n && v) addSpec(n.textContent, v.textContent); }\n"
  + "  }\n"
  + "  res.structSpecs = Object.keys(res.specs).length;\n"
  + "  if (!res.title) { res.title = document.querySelector('meta[property=\\\"og:title\\\"]')?.getAttribute('content') || document.querySelector('h1')?.textContent?.trim() || ''; }\n"
  + "  if (!res.image) { res.image = document.querySelector('meta[property=\\\"og:image\\\"]')?.getAttribute('content') || ''; }\n"
  + "  res.price = res.price.replace(/[^0-9.,]/g, '').replace(',', '.');\n"
  // Characteristics fallback: if structured props are scarce, harvest visible spec tables/lists.
  // Price & photo are NOT taken from here — only key:value characteristic rows.
  + "  if (Object.keys(res.specs).length < 3) {\n"
  + "    const bad = /^(цена|стоимость|price|артикул|sku|код товара|рейтинг|отзыв|гарант|доставк|оплат|кредит|бонус|акци|скидк|в наличии|под заказ)/i;\n"
  + "    const okKey = k => k && k.length >= 2 && k.length < 80 && /[а-яёa-z]/i.test(k) && !bad.test(k);\n"
  + "    const okVal = v => v && v.length >= 1 && v.length < 200;\n"
  + "    for (const dl of document.querySelectorAll('dl')) { const dts = dl.querySelectorAll('dt'); const dds = dl.querySelectorAll('dd'); for (let i = 0; i < dts.length && i < dds.length; i++) { const k = dts[i].textContent.trim(); const v = dds[i].textContent.trim(); if (okKey(k) && okVal(v)) addSpec(k, v); } }\n"
  + "    for (const tr of document.querySelectorAll('table tr')) { const c = tr.querySelectorAll('th,td'); if (c.length >= 2) { const k = c[0].textContent.trim(); const v = c[1].textContent.trim(); if (okKey(k) && okVal(v)) addSpec(k, v); } }\n"
  + "    const SPEC_SEL = '[class*=\\\"spec\\\" i],[class*=\\\"char\\\" i],[class*=\\\"param\\\" i],[class*=\\\"prop\\\" i],[class*=\\\"attrib\\\" i]';\n"
  + "    for (const el of document.querySelectorAll(SPEC_SEL)) { const ch = [...el.children]; if (ch.length !== 2) continue; if (ch.every(c => c.children.length >= 2)) continue; const k = ch[0].textContent.trim(); const v = ch[1].textContent.trim(); if (okKey(k) && okVal(v) && k !== v) addSpec(k, v); }\n"
  + "  }\n"
  + "  return JSON.stringify(res);\n"
  + "})()";

// Minimum characteristics (structured or DOM) for a page to count as a usable product.
const MIN_SPECS = 3;

function parseStructured(raw) {
  const empty = { title: '', image: '', price: null, specs: [], found: false };
  if (!raw || typeof raw !== 'string') return empty;
  try {
    const obj = JSON.parse(raw);
    const specs = Object.entries(obj.specs || {})
      .filter(([, v]) => v && String(v).length < 300)
      .map(([k, v]) => `${k}: ${v}`);
    return {
      title: obj.title ?? '',
      image: obj.image ?? '',
      price: obj.price ? Number(parseFloat(obj.price)) || null : null,
      specs,
      found: Boolean(obj.found),
    };
  } catch { return empty; }
}

// Usable product: structured Product (price+photo via JSON-LD/Microdata) AND a title,
// image, price, plus at least MIN_SPECS characteristics (from additionalProperty or DOM).
function isUsableProduct({ found, title, image, price, specs }) {
  return Boolean(found) && Boolean(title) && Boolean(image)
    && typeof price === 'number' && price > 0 && specs.length >= MIN_SPECS;
}

function isProductPath(url) {
  try {
    const u = new URL(url);
    const p = u.pathname;
    const subdomain = u.hostname.replace(/^www\./, '').split('.')[0];
    if (ARTICLE_PATH_RE.test(p)) return false;
    if (/\/(otzyvy|reviews?|opisanie|video|question|vopros|forum|discuss)\/?$/.test(p)) return false;
    if (REVIEW_DOMAIN_RE.test(subdomain)) return false;
    // Numeric segment or numeric suffix before slash/end — product ID
    if (/(?:\/|-)\d{5,}(?:\/|$)/.test(p)) return true;
    if (PRODUCT_PATH_RE.test(p)) return true;
    // Last path segment contains both letters and digits — likely a product slug (e.g. /shiny/205-55-r17-pirelli/)
    const segs = p.split('/').filter(Boolean);
    if (segs.length >= 2) {
      const last = segs[segs.length - 1];
      if (/\d/.test(last) && /[a-zа-яё]/i.test(last)) return true;
    }
    return false;
  } catch { return false; }
}

function isShopUrl(url) {
  try {
    const u = new URL(url);
    const subdomain = u.hostname.replace(/^www\./, '').split('.')[0];
    if (REVIEW_DOMAIN_RE.test(subdomain)) return false;
    if (ARTICLE_PATH_RE.test(u.pathname)) return false;
    return true;
  } catch { return false; }
}

async function evaluatePage(tabId, { timeoutMs = 45000 } = {}) {
  const rawBlocked = await sb.evaluate(tabId, IS_BLOCKED, { timeoutMs }).catch(() => null);
  try { if (JSON.parse(rawBlocked) === true) return null; } catch {}
  const rawStruct = await sb.evaluate(tabId, STRUCTURED_EXTRACT, { timeoutMs }).catch(() => null);
  const { title, image, price, specs, found } = parseStructured(rawStruct);
  const isProduct = isUsableProduct({ found, title, image, price, specs });
  return { isProduct, found, specs, meta: { title, image, price } };
}

async function loadAndExtract(url, { timeoutMs = 45000 } = {}) {
  const stealthAvail = await sb.isAvailable().catch(() => false);

  if (stealthAvail) {
    let tabId = null;
    try {
      tabId = await sb.openTab(url, { sessionKey: 'universal_scraper', timeoutMs });
      await sb.waitMs(tabId, PAGE_SETTLE, { timeoutMs });
      const pageResult = await evaluatePage(tabId, { timeoutMs });
      if (!pageResult) throw new Error('blocked');
      const { isProduct, specs, meta } = pageResult;
      if (isProduct) return { isProduct, specs, meta };
      // Not a structured product page — treat as catalog: find product links and navigate
      {
        const rawLinks = await sb.evaluate(tabId, EXTRACT_PRODUCT_LINKS, { timeoutMs }).catch(() => '[]');
        let links = [];
        try { links = JSON.parse(rawLinks); } catch {}
        let productLinks = links.filter(isProductPath);
        // If no direct product links, try one subcategory level deeper
        if (productLinks.length === 0) {
          const subLinks = links.filter(l => {
            try { const p = new URL(l).pathname; return p !== '/' && p.split('/').filter(Boolean).length >= 2; } catch { return false; }
          });
          for (const sub of subLinks.slice(0, 2)) {
            await sb.navigate(tabId, sub, { timeoutMs });
            await sb.waitMs(tabId, 2000, { timeoutMs });
            const rawSub = await sb.evaluate(tabId, EXTRACT_PRODUCT_LINKS, { timeoutMs }).catch(() => '[]');
            let subLinks2 = [];
            try { subLinks2 = JSON.parse(rawSub); } catch {}
            productLinks = subLinks2.filter(isProductPath);
            if (productLinks.length > 0) break;
          }
        }
        for (const link of productLinks.slice(0, 5)) {
          await sb.navigate(tabId, link, { timeoutMs });
          await sb.waitMs(tabId, PAGE_SETTLE, { timeoutMs });
          const result = await evaluatePage(tabId, { timeoutMs });
          if (result && result.isProduct) return { ...result, finalUrl: link };
          // One more level: current page may be a subcatalog, try its product links
          if (result && !result.isProduct) {
            const rawDeep = await sb.evaluate(tabId, EXTRACT_PRODUCT_LINKS, { timeoutMs }).catch(() => '[]');
            let deepLinks = [];
            try { deepLinks = JSON.parse(rawDeep); } catch {}
            for (const deep of deepLinks.filter(isProductPath).slice(0, 3)) {
              if (deep === link) continue;
              await sb.navigate(tabId, deep, { timeoutMs });
              await sb.waitMs(tabId, PAGE_SETTLE, { timeoutMs });
              const r2 = await evaluatePage(tabId, { timeoutMs });
              if (r2 && r2.isProduct) return { ...r2, finalUrl: deep };
            }
          }
        }
      }
      return { isProduct, specs, meta };
    } catch { /* fall through */ }
    finally { if (tabId) await sb.closeTab(tabId).catch(() => {}); }
  }

  // Playwright fallback
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] });
    try {
      const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        locale: 'ru-RU',
      });
      await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
      const page = await ctx.newPage();

      const evalStructured = async () => {
        const raw = await page.evaluate(STRUCTURED_EXTRACT).catch(() => null);
        return parseStructured(typeof raw === 'string' ? raw : JSON.stringify(raw));
      };
      // Wait until a Product structure is present (SPA hydration) instead of a fixed delay.
      const waitForStructure = () => page.waitForFunction(
        "document.querySelector('script[type=\"application/ld+json\"]') || document.querySelector('[itemtype*=\"schema.org/Product\" i]')",
        { timeout: 8000 },
      ).catch(() => {});
      // Wait until catalog product links appear.
      const waitForLinks = () => page.waitForFunction(
        "[...document.querySelectorAll('a[href]')].some(a => /(\\/product|\\/tovar|\\/item|\\/good|\\/p\\/|\\/detail|\\/card|\\/\\d{5,})/i.test(a.getAttribute('href')||''))",
        { timeout: 8000 },
      ).catch(() => {});

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await waitForStructure();

      const { title, image, price, specs, found } = await evalStructured();
      const meta = { title, image, price };
      if (isUsableProduct({ found, title, image, price, specs })) return { isProduct: true, specs, meta };

      await waitForLinks();
      const rawLinks = await page.evaluate(EXTRACT_PRODUCT_LINKS).catch(() => '[]');
      let links = [];
      try { links = JSON.parse(typeof rawLinks === 'string' ? rawLinks : JSON.stringify(rawLinks)); } catch {}
      const productLinks = links.filter(isProductPath);
      for (const link of productLinks.slice(0, 5)) {
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await waitForStructure();
        const s = await evalStructured();
        if (isUsableProduct({ found: s.found, title: s.title, image: s.image, price: s.price, specs: s.specs })) {
          return { isProduct: true, specs: s.specs, meta: { title: s.title, image: s.image, price: s.price }, finalUrl: link };
        }
      }
      return { isProduct, specs, meta };
    } finally { await browser.close().catch(() => {}); }
  } catch { return { isProduct: false, specs: [], meta: { title: '', image: '', price: null } }; }
}

function parseBingResults(html) {
  const urls = [];
  for (const m of html.matchAll(/<cite[^>]*>([\s\S]*?)<\/cite>/g)) {
    const text = m[1].replace(/<[^>]+>/g, '').trim();
    const parts = text.split(/\s*›\s*/);
    let base = parts[0].trim();
    if (!base.startsWith('http')) base = 'https://' + base;
    try {
      const u = new URL(base);
      const d = u.hostname.replace(/^www\./, '');
      if (SKIP_DOMAINS.has(d)) continue;
      const extraPath = parts.slice(1).filter(Boolean).map(p => p.trim()).join('/');
      const full = u.origin + (extraPath ? '/' + extraPath : u.pathname);
      if (!urls.includes(full)) urls.push(full);
    } catch { /* invalid */ }
  }
  return urls;
}


async function fetchBingPage(query, first, { fetchImpl, timeoutMs }) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query + ' купить')}&setlang=ru&cc=RU&first=${first}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9',
      },
    });
    if (!resp.ok) return [];
    return parseBingResults(await resp.text());
  } catch { return []; }
  finally { clearTimeout(timer); }
}

async function searchBing(query, { fetchImpl = globalThis.fetch, timeoutMs = 15000, pages = 2 } = {}) {
  const seen = new Set();
  const result = [];
  for (let page = 0; page < pages; page += 1) {
    const first = page * 10 + 1;
    const urls = await fetchBingPage(query, first, { fetchImpl, timeoutMs });
    for (const u of urls) {
      if (!seen.has(u)) { seen.add(u); result.push(u); }
    }
  }
  return result;
}

export async function scrapeUniversal({ normalizedQuery, limit = 15, timeoutMs = 60000, fetchImpl = globalThis.fetch } = {}) {
  const query = normalizedQuery.original || normalizedQuery.normalized;
  const urls = await searchBing(query, { fetchImpl, timeoutMs: 15000 });

  const offers = [];
  const attempted = [];
  for (const url of urls.filter(isShopUrl)) {
    if (offers.length >= limit) break;
    attempted.push(url);
    const extracted = await loadAndExtract(url, { timeoutMs });
    if (!extracted) continue;
    const { isProduct, specs, meta, finalUrl } = extracted;
    if (!isProduct) continue;
    if (specs.length < MIN_SPECS) continue;
    if (!meta.title) continue;
    if (!meta.price || meta.price < 500) continue;
    const productUrl = finalUrl || url;
    try { if (new URL(productUrl).pathname === '/') continue; } catch {}
    const relevance_score = scoreOffer(normalizedQuery.tokens, { title: meta.title, features: specs }, normalizedQuery.specTokens ?? []);
    if (relevance_score < 1) continue;

    offers.push({
      source: 'universal',
      title: meta.title,
      price: meta.price,
      currency: 'RUB',
      product_url: productUrl,
      image_url: meta.image ?? '',
      availability: 'unknown',
      features: specs,
      relevance_score,
      fetched_at: new Date().toISOString(),
      raw_payload: { retrieval_mode: 'universal_scraper', source_url: url },
    });
  }

  return { offers, liveHit: offers.length > 0, attempts: attempted };
}
