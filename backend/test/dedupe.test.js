import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeOffers, groupBySource } from '../src/lib/dedupe.js';
import { buildPriceSummary } from '../src/lib/summary.js';

test('dedupeOffers removes duplicate product variants', () => {
  const offers = [
    { source: 'wildberries', title: 'Apple iPhone 15 128GB Black', price: 80000, relevance_score: 80 },
    { source: 'ozon', title: 'iPhone 15 128 GB Apple', price: 79900, relevance_score: 85 },
    { source: 'yandex_market', title: 'Samsung Galaxy S24', price: 90000, relevance_score: 60 },
  ];

  const deduped = dedupeOffers(offers);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].source, 'ozon');
});

test('groupBySource and buildPriceSummary work on the same set', () => {
  const offers = [
    { source: 'wildberries', title: 'A', price: 10, relevance_score: 1, product_url: 'a' },
    { source: 'wildberries', title: 'B', price: 30, relevance_score: 2, product_url: 'b' },
    { source: 'ozon', title: 'C', price: 20, relevance_score: 3, product_url: 'c' },
  ];

  const grouped = groupBySource(offers);
  assert.equal(grouped.wildberries.length, 2);
  assert.equal(grouped.ozon.length, 1);

  const summary = buildPriceSummary(offers);
  assert.equal(summary.count, 3);
  assert.equal(summary.min_price, 10);
  assert.equal(summary.median_price, 20);
  assert.equal(summary.max_price, 30);
});
