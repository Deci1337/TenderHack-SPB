const STOPWORDS = new Set([
  'и', 'в', 'на', 'для', 'с', 'по', 'the', 'a', 'an', 'of', 'and', 'or', 'new', 'купить'
]);

const TYPO_MAP = new Map([
  ['айфон', 'iphone'],
  ['аифон', 'iphone'],
  ['айфн', 'iphone'],
  ['iphon', 'iphone'],
  ['самсунг', 'samsung'],
  ['galaxi', 'galaxy'],
  ['макбук', 'macbook'],
]);

const SYNONYMS = new Map([
  ['iphone', ['айфон', 'apple iphone']],
  ['samsung', ['самсунг']],
  ['macbook', ['макбук']],
]);

function cleanToken(token) {
  const corrected = TYPO_MAP.get(token) ?? token;
  return corrected;
}

function tokenize(input) {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['"`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(cleanToken)
    .filter((token) => !STOPWORDS.has(token));
}

function expandTokens(tokens) {
  const variants = new Set();
  const base = tokens.join(' ');
  if (base) variants.add(base);

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const synonyms = SYNONYMS.get(token) ?? [];
    for (const synonym of synonyms) {
      const clone = tokens.slice();
      clone[i] = synonym;
      variants.add(clone.join(' '));
    }
  }

  return [...variants];
}

export function normalizeQuery(rawQuery) {
  const original = rawQuery ?? '';
  const trimmed = original.trim();

  if (!trimmed) {
    return {
      original,
      normalized: '',
      tokens: [],
      expandedQueries: [],
      corrections: [],
      isEmpty: true,
    };
  }

  const rawTokens = trimmed
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const corrections = [];
  const tokens = rawTokens
    .map((token) => {
      const corrected = cleanToken(
        token
          .normalize('NFKD')
          .replace(/\p{M}/gu, '')
      );
      if (corrected !== token) {
        corrections.push({ from: token, to: corrected });
      }
      return corrected;
    })
    .filter((token) => !STOPWORDS.has(token));

  const normalized = tokens.join(' ');

  return {
    original,
    normalized,
    tokens,
    expandedQueries: expandTokens(tokens),
    corrections,
    isEmpty: false,
  };
}

export function scoreOffer(queryTokens, offer) {
  const titleTokens = tokenize(offer.title);
  const featureTokens = tokenize((offer.features ?? []).join(' '));
  const haystack = new Set([...titleTokens, ...featureTokens]);

  let score = 0;
  let matches = 0;
  for (const token of queryTokens) {
    if (haystack.has(token)) {
      matches += 1;
      score += 20;
    }
  }

  if (matches === queryTokens.length && queryTokens.length > 0) {
    score += 30;
  }

  const brand = inferBrand(offer.title);
  if (queryTokens.includes(brand)) {
    score += 15;
  }

  if ((offer.availability ?? '').toLowerCase() === 'in_stock') {
    score += 5;
  }

  return Math.min(score, 100);
}

export function inferBrand(title) {
  const normalized = tokenize(title);
  if (normalized.includes('iphone') || normalized.includes('apple')) return 'apple';
  if (normalized.includes('samsung')) return 'samsung';
  if (normalized.includes('xiaomi')) return 'xiaomi';
  if (normalized.includes('honor')) return 'honor';
  if (normalized.includes('macbook')) return 'apple';
  return '';
}

export function tokenizeForKey(text) {
  return tokenize(text).filter((token) => token.length > 1);
}
