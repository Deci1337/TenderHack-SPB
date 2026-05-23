import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuery, scoreOffer } from '../src/lib/query.js';

test('normalizeQuery fixes common typos and brand synonyms', () => {
  const result = normalizeQuery('  Айфон 15 Pro  ');
  assert.equal(result.normalized, 'iphone 15 pro');
  assert.ok(result.expandedQueries.includes('iphone 15 pro'));
  assert.ok(result.expandedQueries.includes('айфон 15 pro'));
  assert.deepEqual(result.corrections, [{ from: 'айфон', to: 'iphone' }]);
});

test('scoreOffer prefers matching offers', () => {
  const query = normalizeQuery('iphone 15');
  const score = scoreOffer(query.tokens, {
    title: 'Apple iPhone 15 128GB Black',
    features: ['128 GB'],
    availability: 'in_stock',
  });
  const weakScore = scoreOffer(query.tokens, {
    title: 'Samsung Galaxy S24',
    features: ['256 GB'],
    availability: 'in_stock',
  });

  assert.ok(score > weakScore);
  assert.ok(score <= 100);
});
