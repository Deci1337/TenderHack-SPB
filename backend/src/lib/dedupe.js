import { inferBrand, tokenizeForKey } from './query.js';

const STOPWORDS = new Set(['new', 'pro', 'max', 'plus', 'mini', 'gb', 'tb', 'black', 'white', 'red', 'blue']);

function buildKey(offer) {
  const brand = inferBrand(offer.title) || 'unknown';
  const tokens = [...new Set(
    tokenizeForKey(offer.title)
      .flatMap((token) => token.match(/\d+|[a-zа-я]+/giu) ?? [token])
      .filter((token) => !STOPWORDS.has(token))
  )].sort();
  const core = tokens.slice(0, 6).join(' ');
  const priceBucket = Number.isFinite(offer.price) ? Math.round(offer.price / 500) : 'na';
  return `${brand}|${core}|${priceBucket}`;
}

export function dedupeOffers(offers) {
  const bestByKey = new Map();

  for (const offer of offers) {
    const key = buildKey(offer);
    const current = bestByKey.get(key);
    if (!current) {
      bestByKey.set(key, offer);
      continue;
    }

    const currentScore = current.relevance_score ?? 0;
    const nextScore = offer.relevance_score ?? 0;
    const preferNext =
      nextScore > currentScore ||
      (nextScore === currentScore && offer.price < current.price) ||
      (nextScore === currentScore && offer.price === current.price && String(offer.source) < String(current.source));

    if (preferNext) {
      bestByKey.set(key, offer);
    }
  }

  return [...bestByKey.values()];
}

export function groupBySource(offers) {
  return offers.reduce((acc, offer) => {
    if (!acc[offer.source]) acc[offer.source] = [];
    acc[offer.source].push(offer);
    return acc;
  }, {});
}
