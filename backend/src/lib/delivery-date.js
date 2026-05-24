// Extracts expected delivery date from a product page via stealth browser.
// Returns delivery_days (integer) or null if not found / page blocked.
//
// Strategy per source:
//   WB:   button text "Доставим DD месяц" near add-to-cart, or delivery widget
//   Ozon: button "В корзину / Доставим DD месяц", or block "Курьером Ozon DD месяц"
//   YM:   [data-auto="delivery-info"] or span with "Доставим / Привезём DD месяц"
//
// Date parsing: Russian month names → JS Date → diff in calendar days from today.
// If delivery date < today (stale page) → null.
// If no date found → null (caller skips the offer).

import * as sb from './stealth-browser.js';
import { applyMarketplaceRegion } from './marketplace-region.js';

const RU_MONTHS = {
  'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3,
  'мая': 4, 'июня': 5, 'июля': 6, 'августа': 7,
  'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11,
};

const ORIGIN_CITY_CASES = {
  'москве': 'Москва',
  'москва': 'Москва',
  'москвы': 'Москва',
  'санкт-петербурге': 'Санкт-Петербург',
  'санкт-петербург': 'Санкт-Петербург',
  'петербурге': 'Санкт-Петербург',
  'красноярске': 'Красноярск',
  'красноярск': 'Красноярск',
  'магадане': 'Магадан',
  'магадан': 'Магадан',
  'новосибирске': 'Новосибирск',
  'новосибирск': 'Новосибирск',
  'екатеринбурге': 'Екатеринбург',
  'екатеринбург': 'Екатеринбург',
  'казани': 'Казань',
  'казань': 'Казань',
  'владивостоке': 'Владивосток',
  'владивосток': 'Владивосток',
  'хабаровске': 'Хабаровск',
  'хабаровск': 'Хабаровск',
};

function toLocalIsoDate(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLocalIsoDate(value) {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date(value);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// Парсит срок доставки в Date. Понимает абсолютные даты ("15 июня", "15 июня 2026")
// и относительные формулировки маркетплейсов ("сегодня", "завтра", "послезавтра").
export function parseRuDate(text, { now = new Date() } = {}) {
  const lower = text.toLowerCase();

  const m = text.match(/(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(\d{4}))?/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = RU_MONTHS[m[2].toLowerCase()];
    const year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
    const d = new Date(year, month, day);
    // Если дата уже прошла в этом году — скорее всего следующий год
    if (d < now && !m[3]) d.setFullYear(year + 1);
    return d;
  }

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (/послезавтра/.test(lower)) { const d = new Date(today); d.setDate(d.getDate() + 2); return d; }
  if (/завтра/.test(lower)) { const d = new Date(today); d.setDate(d.getDate() + 1); return d; }
  if (/сегодня|по клику|в течение часа|\d+\s*[–-]?\s*\d*\s*мин/.test(lower)) return new Date(today);
  return null;
}

// Разница в календарных днях: сегодня = 0, завтра = 1
export function diffDays(deliveryDate, { now = new Date() } = {}) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(deliveryDate);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

export function parseDeliveryDeadline(value, { now = new Date() } = {}) {
  if (!value) return null;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const ru = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const parts = iso
    ? { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) }
    : ru
      ? { y: Number(ru[3]), m: Number(ru[2]), d: Number(ru[1]) }
      : null;
  if (!parts) return null;
  const date = new Date(parts.y, parts.m - 1, parts.d);
  if (date.getFullYear() !== parts.y || date.getMonth() !== parts.m - 1 || date.getDate() !== parts.d) {
    return null;
  }
  const days = diffDays(date, { now });
  if (days < 0) return null;
  return { date, maxDeliveryDays: days };
}

// Человекочитаемая метка срока: "сегодня", "завтра", "3 дн.", "15 дн."
export function formatDeliveryDays(days) {
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return `${days} дн.`;
}

export function formatDeliveryDate(date) {
  if (!date) return '';
  return parseLocalIsoDate(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function parseDeliveryText(text, { now = new Date() } = {}) {
  if (!text) return null;
  const date = parseRuDate(String(text), { now });
  if (!date) return null;
  const days = diffDays(date, { now });
  if (days < 0) return null;
  const dateIso = toLocalIsoDate(date);
  return {
    days,
    text: `Доставка ${formatDeliveryDays(days)}, ${formatDeliveryDate(dateIso)}`,
    rawText: String(text).trim(),
    date,
    dateIso,
    shipmentOriginCity: parseShipmentOriginCity(text),
  };
}

export function parseShipmentOriginCity(text) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  const patterns = [
    /со\s+склада\s+в\s+([А-ЯЁа-яё -]{3,40})/i,
    /склад[:\s]+([А-ЯЁа-яё -]{3,40})/i,
    /отправ(?:ка|ят|ляется|им)?\s+из\s+([А-ЯЁа-яё -]{3,40})/i,
    /из\s+города\s+([А-ЯЁа-яё -]{3,40})/i,
  ];

  for (const pattern of patterns) {
    const m = raw.match(pattern);
    if (!m) continue;
    const city = m[1]
      .replace(/\b(до|к|на|пункт|курьер|доставка|доставим|получите)\b.*$/i, '')
      .replace(/[.,;:]+$/g, '')
      .trim();
    const normalized = ORIGIN_CITY_CASES[city.toLowerCase()];
    return normalized ?? city.replace(/^./, (c) => c.toUpperCase());
  }
  return null;
}

function offerDeliveryHint(offer) {
  return offer.delivery_text
    ?? offer.raw_payload?.delivery_text
    ?? offer.raw_payload?.deliveryDate
    ?? offer.raw_payload?.delivery
    ?? null;
}

// DOM-скрипты для каждого источника.
// Ищут текст вида "Доставим 15 июня" в ключевых элементах.
// Возвращают строку с датой или пустую строку.

const WB_DELIVERY_EXTRACT = "(() => {" +
  "  const sel = ['[class*=\"delivery\"]','[class*=\"Delivery\"]','[data-widget=\"webAddToCart\"]','.button-text','button'];" +
  "  for (const s of sel) {" +
  "    for (const el of document.querySelectorAll(s)) {" +
  "      const t = el.textContent || '';" +
  "      const m = t.match(/(доставим|получите|будет|доставка)\\s*(\\d{1,2}\\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))/i);" +
  "      if (m) return t.trim().slice(0, 300);" +
  "    }" +
  "  }" +
  "  return '';" +
"})()";

const OZON_DELIVERY_EXTRACT = "(() => {" +
  "  const sel = ['button[data-widget]','[data-widget=\"webAddToCart\"]','[data-widget=\"webDelivery\"]','[class*=\"delivery\"]','[class*=\"Delivery\"]'];" +
  "  for (const s of sel) {" +
  "    for (const el of document.querySelectorAll(s)) {" +
  "      const t = el.textContent || '';" +
  "      const m = t.match(/(доставим|доставка|курьером|пункт).*?(\\d{1,2}\\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))/i);" +
  "      if (m) return t.trim().slice(0, 300);" +
  "    }" +
  "  }" +
  "  return '';" +
"})()";

const YM_DELIVERY_EXTRACT = "(() => {" +
  "  const sel = ['[data-auto=\"deliveryVariant\"]','[data-auto=\"snippet-delivery-options\"]','[data-auto=\"snippet-delivery-options-title\"]','[data-auto*=\"delivery\"]','[class*=\"delivery\"]','[class*=\"Delivery\"]'];" +
  "  const rel = /(сегодня|послезавтра|завтра|по клику|\\d{1,2}\\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))/i;" +
  "  for (const s of sel) {" +
  "    for (const el of document.querySelectorAll(s)) {" +
  "      const t = (el.textContent || '').trim();" +
  "      if (t.length > 200) continue;" +
  "      const m = t.match(rel);" +
  "      if (m) return t.trim().slice(0, 300);" +
  "    }" +
  "  }" +
  "  return '';" +
"})()";

const SOURCE_SCRIPT = {
  wildberries: WB_DELIVERY_EXTRACT,
  ozon: OZON_DELIVERY_EXTRACT,
  yandex_market: YM_DELIVERY_EXTRACT,
};

const SOURCE_SETTLE = {
  wildberries: 8000,
  ozon: 6000,
  yandex_market: 8000,
};

// Возвращает дату/кол-во дней до доставки или null
export async function fetchDeliveryInfo(source, productUrl, { timeoutMs = 60000, geo = null } = {}) {
  const script = SOURCE_SCRIPT[source];
  if (!script || !productUrl) return null;

  const stealthAvail = await sb.isAvailable().catch(() => false);
  if (!stealthAvail) return null;

  let tabId = null;
  try {
    tabId = await sb.openTab(productUrl, { sessionKey: `${source}_delivery`, timeoutMs });
    await applyMarketplaceRegion(tabId, source, geo, { searchUrl: productUrl, timeoutMs }).catch(() => {});
    await sb.waitMs(tabId, SOURCE_SETTLE[source] ?? 6000, { timeoutMs });
    // Product cards lazy-render the delivery block — scroll to force it in.
    for (let i = 0; i < 3; i += 1) {
      await sb.scroll(tabId, { amount: 1000, timeoutMs: 15000 }).catch(() => {});
      await sb.waitMs(tabId, 1000, { timeoutMs }).catch(() => {});
    }
    const raw = await sb.evaluate(tabId, script, { timeoutMs });
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) return null;
    const date = parseRuDate(text);
    if (!date) return null;
    const days = diffDays(date);
    if (days < 0) return null;
    return {
      days,
      text,
      date,
      dateIso: toLocalIsoDate(date),
      shipmentOriginCity: parseShipmentOriginCity(text),
    };
  } catch {
    return null;
  } finally {
    if (tabId) await sb.closeTab(tabId).catch(() => {});
  }
}

// Возвращает кол-во дней до доставки или null
export async function fetchDeliveryDays(source, productUrl, { timeoutMs = 60000, geo = null } = {}) {
  const info = await fetchDeliveryInfo(source, productUrl, { timeoutMs, geo });
  return info?.days ?? null;
}

export function filterAndSortByDelivery(offers, maxDeliveryDays) {
  if (maxDeliveryDays == null) return offers;
  return offers
    .filter((o) => o.delivery_days != null && o.delivery_days <= maxDeliveryDays)
    .sort((a, b) => a.delivery_days - b.delivery_days || a.price - b.price);
}

// Обогащает массив офферов полем delivery_days.
// Скипает оффер если дата не найдена (delivery_days остаётся undefined).
// maxDeliveryDays: если задан — сразу фильтрует и сортирует.
export async function enrichAndFilterByDelivery(offers, {
  maxDeliveryDays,
  timeoutMs = 60000,
  geo = null,
  fetchDeliveryInfoImpl = fetchDeliveryInfo,
  now = new Date(),
} = {}) {
  await Promise.allSettled(
    offers.map(async (offer) => {
      offer.delivery_filter_status = 'checked';
      const hint = offerDeliveryHint(offer);
      const hintInfo = parseDeliveryText(hint, { now });
      const pageInfo = !hintInfo || !hintInfo.shipmentOriginCity
        ? await fetchDeliveryInfoImpl(offer.source, offer.product_url, { timeoutMs, geo })
        : null;
      const info = hintInfo ?? pageInfo;
      if (info) {
        offer.delivery_days = info.days;
        offer.delivery_date = info.dateIso;
        offer.delivery_text = info.text;
        const shipmentOriginCity = info.shipmentOriginCity ?? pageInfo?.shipmentOriginCity;
        if (shipmentOriginCity) {
          offer.shipment_origin_city = shipmentOriginCity;
          const deepText = pageInfo?.rawText ?? pageInfo?.text;
          if (deepText && deepText !== info.rawText) {
            offer.delivery_deep_text = deepText;
          }
        }
        offer.delivery_filter_status = info.days <= maxDeliveryDays ? 'inside_deadline' : 'outside_deadline';
      } else {
        offer.delivery_filter_status = hint ? 'unparsed_hint' : 'not_found_or_blocked';
      }
    })
  );

  if (maxDeliveryDays == null) return offers;

  return filterAndSortByDelivery(offers, maxDeliveryDays);
}
