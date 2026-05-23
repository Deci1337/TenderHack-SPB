#!/usr/bin/env node
/**
 * Тестовый запуск Playwright-парсеров для WB, Ozon, Яндекс Маркет.
 * Запуск: node scripts/test_parsers.js "кофемашина"
 *
 * Переменные окружения:
 *   HTTPS_PROXY=http://user:pass@host:port  — HTTP/HTTPS прокси
 *   PLAYWRIGHT_TIMEOUT=90000               — таймаут в мс (default 90000)
 */

import { chromium } from 'playwright';
import { scrapeWildberries, scrapeOzon, scrapeYandexMarket } from '../src/lib/playwright-scraper.js';
import { normalizeQuery } from '../src/lib/query.js';

async function checkPlaywrightIp(proxyUrl) {
  const launchOpts = { headless: true };
  if (proxyUrl) launchOpts.proxy = { server: proxyUrl };
  const browser = await chromium.launch(launchOpts);
  try {
    const page = await browser.newPage();
    const resp = await page.goto('https://ipinfo.io/json', { timeout: 15000 });
    const data = JSON.parse(await resp.text());
    return { ip: data.ip, org: data.org };
  } catch (err) {
    return { ip: null, org: `ошибка проверки: ${err.message}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

const DATACENTER_HINTS = ['datacamp', 'cdn77', 'datacenter', 'hosting', 'cloud', 'ovh', 'hetzner', 'amazon', 'google', 'digitalocean'];

const query = process.argv[2] ?? 'кофемашина';
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || undefined;
const timeoutMs = process.env.PLAYWRIGHT_TIMEOUT ? Number(process.env.PLAYWRIGHT_TIMEOUT) : 90000;

const nq = normalizeQuery(query);
console.log(`\nЗапрос: "${query}" → нормализовано: "${nq.normalized}"`);
if (proxyUrl) console.log(`Прокси: ${proxyUrl}`);

console.log('\n🌐 Проверка IP, который видит Playwright-браузер...');
const ipInfo = await checkPlaywrightIp(proxyUrl);
const orgLower = (ipInfo.org ?? '').toLowerCase();
const isDatacenter = DATACENTER_HINTS.some((h) => orgLower.includes(h));
console.log(`   IP браузера: ${ipInfo.ip ?? 'неизвестен'}  (${ipInfo.org ?? '—'})`);
if (isDatacenter) {
  console.log('   ⚠️  Это ДАТАЦЕНТРОВЫЙ IP — WB/Ozon/ЯМ блокируют такие запросы.');
  console.log('   Браузер выходит через VPN/прокси-туннель, даже если системный curl показывает жилой IP.');
  console.log('   → Полностью закройте VPN-приложение (туннель захватывает именно Chromium).');
} else if (ipInfo.ip) {
  console.log('   ✅ IP похож на жилой — если данные не приходят, причина в antibot/селекторах.');
}
console.log('─'.repeat(60));

async function runScraper(name, scraperFn) {
  console.log(`\n🔍 ${name}...`);
  const start = Date.now();
  try {
    const result = await scraperFn({ normalizedQuery: nq, limit: 5, timeoutMs, proxyUrl });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  Статус: ${result.liveHit ? '✅ данные получены' : '❌ заблокировано/недоступно'} (${elapsed}с)`);
    console.log(`  Попыток: ${result.attempts.length}`);
    if (result.offers.length > 0) {
      console.log(`  Товаров: ${result.offers.length}`);
      for (const offer of result.offers.slice(0, 3)) {
        console.log(`    • ${offer.title.slice(0, 50)} — ${offer.price}₽`);
        console.log(`      ${offer.product_url.slice(0, 70)}`);
      }
    } else {
      const blocked = result.attempts.find(a => a.blocked);
      if (blocked) {
        console.log(`  Причина блокировки: ${blocked.error_message ?? blocked.step}`);
      }
    }
    return result;
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  ❌ Ошибка (${elapsed}с): ${err.message}`);
    return { offers: [], liveHit: false };
  }
}

const results = await Promise.allSettled([
  runScraper('Wildberries', scrapeWildberries),
  runScraper('Ozon', scrapeOzon),
  runScraper('Яндекс Маркет', scrapeYandexMarket),
]);

console.log('\n' + '─'.repeat(60));
const totals = results.map(r => r.value?.offers?.length ?? 0);
const total = totals.reduce((a, b) => a + b, 0);
const sources = ['WB', 'Ozon', 'ЯМ'];
console.log('Итого:');
sources.forEach((s, i) => console.log(`  ${s}: ${totals[i]} товаров`));
console.log(`  Всего: ${total} товаров`);
if (total === 0) {
  if (isDatacenter) {
    console.log(`\nℹ️  Причина: браузер выходит через датацентровый IP ${ipInfo.ip} (${ipInfo.org}).`);
    console.log('   Закройте VPN-приложение полностью или используйте прокси с жилым IP:');
    console.log('   HTTPS_PROXY=http://host:port node scripts/test_parsers.js "запрос"');
  } else {
    console.log('\nℹ️  IP браузера жилой, но данные не пришли — antibot-защита или изменились селекторы.');
  }
}
