import { createHash } from 'node:crypto';

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAttributes(offer) {
  const attributes = [];
  for (const feature of offer.features ?? []) {
    if (feature === null || feature === undefined || feature === '') continue;
    attributes.push({ name: 'feature', value: String(feature) });
  }

  const rawPayload = offer.raw_payload ?? {};
  const category = rawPayload.search_result?.category;
  if (category) {
    attributes.push({ name: 'category', value: String(category) });
  }

  const retrievalMode = rawPayload.retrieval_mode;
  if (retrievalMode) {
    attributes.push({ name: 'retrieval_mode', value: String(retrievalMode) });
  }

  return attributes;
}

function buildDocId(query, fetchedAt) {
  return createHash('sha1').update(`${query}::${fetchedAt}`).digest('hex').slice(0, 16);
}

function buildTopSource(offer, rank) {
  return {
    rank,
    source: offer.source,
    title: offer.title,
    price: toNumber(offer.price),
    currency: offer.currency ?? 'RUB',
    url: offer.product_url ?? null,
    score: offer.relevance_score ?? 0,
    availability: offer.availability ?? 'unknown',
  };
}

function buildItem(offer, rank, query, fetchedAt) {
  const price = toNumber(offer.price);
  const currency = offer.currency ?? 'RUB';
  const score = offer.relevance_score ?? 0;
  const sourceUrl = offer.product_url ?? null;

  return {
    item_id: `${offer.source}:${rank}`,
    position_number: rank,
    name: offer.title ?? '',
    normalized_name: query.normalized,
    identifiers: {
      okpd2: null,
      ktru: null,
      sku: null,
      model: null,
    },
    quantity: {
      value: 1,
      unit: 'шт',
    },
    price: {
      unit: price,
      total: price,
      currency,
      vat_percent: null,
      vat_included: true,
    },
    attributes: normalizeAttributes(offer),
    sources: [
      {
        rank: 1,
        name: offer.source,
        url: sourceUrl,
        date: offer.fetched_at ?? fetchedAt,
        price,
        evidence_text: offer.title ?? null,
        evidence_type: offer.raw_payload?.retrieval_mode?.startsWith('live') ? 'page' : 'snippet',
      },
    ],
    selection: {
      accepted_source_rank: 1,
      accepted_price: price,
      reason: `relevance_score=${score}`,
    },
    provenance: {
      source: offer.source,
      fetched_at: offer.fetched_at ?? fetchedAt,
      product_url: sourceUrl,
      query: query.original,
    },
    confidence: Math.max(0, Math.min(1, score / 100)),
  };
}

export function buildUniversalSearchDocument(result, { limit = 10 } = {}) {
  const offers = [...(result.offers ?? [])]
    .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0) || toNumber(a.price) - toNumber(b.price))
    .slice(0, limit);

  const fetchedAt = result.fetched_at ?? new Date().toISOString();
  const query = {
    original: result.original_query ?? '',
    normalized: result.normalized_query ?? '',
  };

  const items = offers.map((offer, index) => buildItem(offer, index + 1, query, fetchedAt));
  const top_sources = offers.map((offer, index) => buildTopSource(offer, index + 1));

  return {
    document: {
      doc_id: buildDocId(query.original || query.normalized, fetchedAt),
      doc_type: 'product_search',
      title: query.original || query.normalized,
      source_file: null,
      date: fetchedAt,
      customer: null,
      query: query.normalized,
    },
    top_sources,
    items,
    calculation: {
      average_price: result.summary?.median_price ?? null,
      variation_percent: null,
      nmck_total: null,
      vat_amount: null,
    },
    raw_text: offers
      .map((offer) => [offer.source, offer.title, offer.price, offer.product_url].filter(Boolean).join('\t'))
      .join('\n'),
    pages: [],
    extra: {
      source_counts: result.source_counts ?? {},
      summary: result.summary ?? {},
    },
  };
}
