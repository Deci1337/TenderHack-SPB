#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { createSearchService } from './pipeline.js';
import { buildAdapters } from './catalog.js';
import { buildUniversalSearchDocument } from './lib/universal-schema.js';
import { formatDeliveryDate, formatDeliveryDays } from './lib/delivery-date.js';
import { resolveGeo } from './lib/geo.js';

function parseArgs(argv) {
  const result = {
    query: [],
    json: false,
    schema: false,
    verbose: false,
    limit: undefined,
    out: undefined,
    sources: undefined,
    city: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      result.json = true;
      continue;
    }
    if (arg === '--schema') {
      result.schema = true;
      continue;
    }
    if (arg === '--verbose') {
      result.verbose = true;
      continue;
    }
    if (arg === '--limit') {
      result.limit = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--out') {
      result.out = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--sources') {
      result.sources = argv[index + 1]
        ?.split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--city') {
      result.city = argv[index + 1];
      index += 1;
      continue;
    }
    result.query.push(arg);
  }

  result.query = result.query.join(' ').trim();
  return result;
}

function formatMoney(price, currency = 'RUB') {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

function formatOfferLine(offer) {
  const parts = [
    offer.source,
    offer.title,
    formatMoney(offer.price, offer.currency),
    `score=${offer.relevance_score}`,
  ];

  if (offer.availability) {
    parts.push(`availability=${offer.availability}`);
  }

  if (offer.raw_payload?.retrieval_mode) {
    parts.push(`mode=${offer.raw_payload.retrieval_mode}`);
  }

  return parts.join(' | ');
}

function formatCharacteristics(offer) {
  const values = new Set();

  for (const feature of offer.features ?? []) {
    if (feature) values.add(String(feature));
  }

  const raw = offer.raw_payload ?? {};
  for (const value of [
    raw.brand,
    raw.subjectName,
    raw.category,
    raw.deliverySchema,
    raw.search_result?.category,
    raw.search_result?.brand,
    raw.product_page?.availability,
  ]) {
    if (value) values.add(String(value));
  }

  return [...values].join('; ');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.query) {
    console.error('Usage: node src/cli.js "<query>" [--city <город>] [--json] [--schema] [--verbose] [--limit N] [--out file] [--sources a,b]');
    process.exitCode = 1;
    return;
  }

  const geo = resolveGeo({ city: args.city });
  const service = createSearchService({
    adapters: buildAdapters({ city: args.city }),
  });
  const result = await service.searchProducts(args.query, {
    limit: args.limit,
    sources: args.sources,
  });
  const payload = args.schema
    ? buildUniversalSearchDocument(result, { limit: args.limit ?? 10 })
    : result;
  const output = JSON.stringify(payload, null, 2);

  if (args.out) {
    await writeFile(args.out, `${output}\n`, 'utf8');
  }

  if (args.verbose) {
    console.error(`Query: ${result.original_query}`);
    console.error(`Normalized: ${result.normalized_query}`);
    console.error(`Sources: ${result.sources.join(', ')}`);
    console.error(`Offers: ${result.offers.length}`);
    for (const entry of result.execution_log) {
      const details = entry.status === 'ok'
        ? `offers=${entry.offers_returned}`
        : `error=${entry.message}`;
      console.error(`  ${entry.source}: ${entry.status} mode=${entry.mode} attempts=${entry.attempts} cache=${entry.cache_hit ? 'hit' : 'miss'} ${details}`);
    }
    console.error(`Parsed cards: ${result.parsed_offers.length}`);
    for (const offer of result.parsed_offers) {
      console.error(`  ${formatOfferLine(offer)}`);
      console.error(`    characteristics: ${formatCharacteristics(offer) || 'n/a'}`);
      console.error(`    ${offer.product_url}`);
    }
  }

  if (args.json || args.schema) {
    process.stdout.write(`${output}\n`);
    return;
  }

  const sourceLabels = {
    wildberries: 'Wildberries',
    ozon: 'Ozon',
    yandex_market: 'Яндекс Маркет',
    universal: 'Рунет',
  };

  console.log(`Query: ${result.original_query}`);
  console.log(`Normalized: ${result.normalized_query}`);
  if (args.city) console.log(`Регион: ${args.city}`);
  if (geo?.deliveryLocation?.address) console.log(`Точка: ${geo.deliveryLocation.address}`);
  console.log(`Sources: ${result.sources.join(', ')}`);
  console.log(`Offers: ${result.summary.count}`);
  console.log(`Per source: ${result.sources.map((source) => `${source}=${result.source_counts[source] ?? 0}`).join(', ')}`);
  console.log(`Price range: ${result.summary.min_price === null ? 'n/a' : formatMoney(result.summary.min_price)} - ${result.summary.max_price === null ? 'n/a' : formatMoney(result.summary.max_price)}`);

  for (let i = 0; i < result.offers.length; i += 1) {
    const offer = result.offers[i];
    const label = sourceLabels[offer.source] ?? offer.source;

    console.log('');
    console.log(`[${i + 1}] ${offer.title}`);
    if (args.city) console.log(`  Регион     ${args.city}`);
    console.log(`  Источник   ${label}`);
    console.log(`  Цена       ${formatMoney(offer.price, offer.currency)}`);
    if (offer.delivery_days != null) {
      const datePart = offer.delivery_date ? `, ${formatDeliveryDate(offer.delivery_date)}` : '';
      console.log(`  Доставка   ${formatDeliveryDays(offer.delivery_days)}${datePart}`);
    } else if (offer.delivery_text) {
      console.log(`  Доставка   ${offer.delivery_text}`);
    }
    if (offer.shipment_origin_city) {
      console.log(`  Отправка   ${offer.shipment_origin_city}`);
    }
    const characteristics = formatCharacteristics(offer);
    console.log(`  Характеристики: ${characteristics || 'н/д'}`);
    if (offer.image_url) {
      console.log(`  Фото       ${offer.image_url}`);
    }
    console.log(`  Ссылка     ${offer.product_url}`);
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exitCode = 1;
});
