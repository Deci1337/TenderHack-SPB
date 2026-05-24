import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBySource, buildPriceSummary } from '../src/lib/summary.js';

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
