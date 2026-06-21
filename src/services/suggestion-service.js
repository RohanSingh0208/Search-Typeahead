/**
 * Suggestion Service — the core typeahead logic.
 *
 * Flow:
 * 1. Normalize prefix (lowercase, trim, escape)
 * 2. Check L1 cache (in-process LRU via CacheManager)
 * 3. Check L2 cache (Redis) — populated from L1 miss
 * 4. On miss: query SQLite, enrich with trending scores, cache in L1 + L2, return
 *
 * Note: getSuggestions is async because CacheManager.lookup / store now
 * make async Redis calls.
 */

const { getCacheManager } = require('../cache/cache-manager');
const { getTopSuggestions } = require('../db/queries');
const { getTrendingService } = require('./trending-service');
const config = require('../config');

function normalizePrefix(prefix) {
  return (prefix || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Get typeahead suggestions for a given prefix.
 * @param {string} rawPrefix - Raw user input
 * @returns {Promise<{ suggestions: Array, source: 'cache'|'redis'|'db', latencyMs: number }>}
 */
async function getSuggestions(rawPrefix) {
  const start = Date.now();
  const prefix = normalizePrefix(rawPrefix);

  // Edge case: empty prefix → return empty
  if (!prefix) {
    return { suggestions: [], source: 'empty', latencyMs: Date.now() - start };
  }

  const cache = getCacheManager();
  const trending = getTrendingService();

  // 1. Cache lookup (L1 then L2/Redis)
  const cached = await cache.lookup(prefix);
  if (cached !== null) {
    return {
      suggestions: cached,
      source: 'cache',
      latencyMs: Date.now() - start,
    };
  }

  // 2. DB query on cache miss
  const dbResults = getTopSuggestions(prefix, config.SUGGESTION_LIMIT * 2); // fetch extra for re-ranking

  // 3. Enrich with trending scores and re-sort
  const enriched = trending.enrichWithTrendingScores(dbResults).slice(0, config.SUGGESTION_LIMIT);

  // 4. Store in cache (L1 + L2)
  await cache.store(prefix, enriched);

  return {
    suggestions: enriched,
    source: 'db',
    latencyMs: Date.now() - start,
  };
}

module.exports = { getSuggestions, normalizePrefix };
