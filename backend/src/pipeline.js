import { normalizeQuery } from './lib/query.js';
import { dedupeOffers, groupBySource } from './lib/dedupe.js';
import { buildPriceSummary } from './lib/summary.js';
import { createResilientExecutor } from './lib/resilience.js';
import { buildAdapters } from './catalog.js';

export function createSearchService({
  adapters = buildAdapters(),
  executor = createResilientExecutor(),
  now = () => new Date().toISOString(),
} = {}) {
  async function searchProducts(rawQuery, options = {}) {
    const normalizedQuery = normalizeQuery(rawQuery);
    if (normalizedQuery.isEmpty) {
      const error = new Error('query is required');
      error.code = 'EMPTY_QUERY';
      throw error;
    }

    const selectedSources = options.sources ?? adapters.map((adapter) => adapter.name);
    const selectedAdapters = adapters.filter((adapter) => selectedSources.includes(adapter.name));
    const offers = [];
    const errors = [];
    const execution_log = [];

    for (const adapter of selectedAdapters) {
      const cacheKey = `${adapter.name}:${normalizedQuery.normalized}`;
      const outcome = await executor.run(
        cacheKey,
        async (context) => adapter.search(normalizedQuery, { ...options, context }),
        { source: adapter.name, query: normalizedQuery.normalized }
      );

      if (outcome.ok) {
        offers.push(...outcome.value);
        execution_log.push({
          source: adapter.name,
          status: 'ok',
          attempts: outcome.attempts,
          cache_hit: outcome.fromCache,
          stale_cache: outcome.stale ?? false,
          mode: outcome.value[0]?.raw_payload?.retrieval_mode ?? 'unknown',
          offers_returned: outcome.value.length,
          health: executor.snapshotHealth?.(adapter.name) ?? null,
        });
      } else {
        const error = outcome.error ?? new Error('unknown error');
        const classified = executor.classifyError?.(error) ?? { code: error.code ?? 'UNKNOWN_ERROR', retryable: false, status: 0, reason: 'unknown' };
        errors.push({
          source: adapter.name,
          message: outcome.error?.message ?? 'unknown error',
          code: classified.code,
          retryable: classified.retryable,
        });
        execution_log.push({
          source: adapter.name,
          status: 'error',
          attempts: outcome.attempts,
          cache_hit: outcome.fromCache,
          stale_cache: false,
          mode: 'error',
          message: outcome.error?.message ?? 'unknown error',
          code: classified.code,
          retryable: classified.retryable,
          status_code: classified.status,
          reason: classified.reason,
          health: executor.snapshotHealth?.(adapter.name) ?? null,
        });
      }
    }

    const deduped = dedupeOffers(offers);
    const limitedOffers = options.limit ? deduped.slice(0, options.limit) : deduped;
    const grouped = groupBySource(limitedOffers);
    const parsedGrouped = groupBySource(offers);
    const source_counts = Object.fromEntries(
      selectedAdapters.map((adapter) => [adapter.name, grouped[adapter.name]?.length ?? 0])
    );
    const parsed_source_counts = Object.fromEntries(
      selectedAdapters.map((adapter) => [adapter.name, parsedGrouped[adapter.name]?.length ?? 0])
    );

    return {
      original_query: normalizedQuery.original,
      normalized_query: normalizedQuery.normalized,
      expanded_queries: normalizedQuery.expandedQueries,
      corrections: normalizedQuery.corrections,
      fetched_at: now(),
      sources: selectedAdapters.map((adapter) => adapter.name),
      parsed_offers: offers,
      parsed_cards: offers,
      parsed_grouped_by_source: parsedGrouped,
      parsed_source_counts,
      offers: limitedOffers,
      grouped_by_source: grouped,
      source_counts,
      summary: buildPriceSummary(limitedOffers),
      execution_log,
      errors,
    };
  }

  return { searchProducts };
}
