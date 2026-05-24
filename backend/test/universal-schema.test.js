import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUniversalSearchDocument } from '../src/lib/universal-schema.js';

test('buildUniversalSearchDocument keeps top 10 offers in a stable schema', () => {
  const result = {
    original_query: 'кофемашина',
    normalized_query: 'кофемашина',
    fetched_at: '2026-05-17T12:00:00.000Z',
    summary: {
      median_price: 10000,
    },
    source_counts: {
      wildberries: 3,
      ozon: 3,
    },
    offers: Array.from({ length: 11 }, (_, index) => ({
      source: index % 2 === 0 ? 'wildberries' : 'ozon',
      title: `Offer ${index + 1}`,
      price: 1000 + index,
      currency: 'RUB',
      product_url: `https://example.com/${index + 1}`,
      relevance_score: 100 - index,
      features: ['feature-a', 'feature-b'],
      fetched_at: '2026-05-17T12:00:00.000Z',
      raw_payload: {
        retrieval_mode: 'live',
      },
    })),
  };

  const schema = buildUniversalSearchDocument(result, { limit: 10 });

  assert.equal(schema.document.doc_type, 'product_search');
  assert.equal(schema.document.title, 'кофемашина');
  assert.equal(schema.top_sources.length, 10);
  assert.equal(schema.items.length, 10);
  assert.equal(schema.items[0].position_number, 1);
  assert.equal(schema.items[0].sources[0].name, 'wildberries');
  assert.equal(schema.items[0].attributes.some((item) => item.name === 'feature'), true);
  assert.equal(schema.extra.source_counts.wildberries, 3);
  assert.equal(schema.calculation.average_price, 10000);
});
