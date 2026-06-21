/**
 * Trending Search Service — recency-aware scoring.
 *
 * Scoring formula:
 *   trending_score = (all_time_count × 0.4) + (recent_1h_count × 50) + (recent_24h_count × 10)
 *
 * Design decisions:
 * - Recent searches are tracked in-memory using time-bucketed counters (minute granularity).
 *   This avoids querying the DB on every suggestion request for recent counts.
 * - Old buckets are pruned every 5 minutes to bound memory usage.
 * - On cache miss, trending scores are computed by combining DB count + in-memory recency.
 * - Freshness vs. latency: trending scores add ~0ms overhead on cache hits,
 *   and a tiny in-memory scan overhead on cache misses.
 *
 * Redis persistence:
 * - Every recordSearch() also writes to Redis sorted sets (ZINCRBY) so trending
 *   data survives a process restart.
 * - On startup, hydrateFromRedis() replays Redis sorted sets back into in-memory
 *   buckets so the service picks up where it left off.
 */

const config = require('../config');
const { isReady, getRedisClient } = require('../cache/redis-client');

/** Redis key for the 1-hour trending sorted set */
const REDIS_TRENDING_1H = 'trending:1h';
/** Redis key for the 24-hour trending sorted set */
const REDIS_TRENDING_24H = 'trending:24h';

class TrendingService {
  constructor() {
    /**
     * Time-bucketed counters: Map<minuteTimestamp, Map<query, count>>
     * minuteTimestamp = Math.floor(Date.now() / 60000) * 60000
     */
    this.buckets = new Map();

    // Prune old buckets periodically
    this._pruneInterval = setInterval(
      () => this._pruneOldBuckets(),
      config.TRENDING_PRUNE_INTERVAL_MS,
    );
    // Allow process to exit even if interval is active
    this._pruneInterval.unref();
  }

  // ─── Recording ───────────────────────────────────────────────────────────────

  /**
   * Record a search event for a query.
   * Called by the batch writer / search service on each search submission.
   * Also persists to Redis sorted sets for durability.
   */
  recordSearch(query, timestamp = Date.now()) {
    // 1. In-memory bucket (synchronous, used for real-time scoring)
    const bucketKey = Math.floor(timestamp / 60000) * 60000; // minute bucket
    if (!this.buckets.has(bucketKey)) {
      this.buckets.set(bucketKey, new Map());
    }
    const bucket = this.buckets.get(bucketKey);
    bucket.set(query, (bucket.get(query) || 0) + 1);

    // 2. Redis persistence (async, fire-and-forget)
    if (isReady()) {
      const redis = getRedisClient();
      const pipeline = redis.multi();
      // ZINCRBY increments the score of 'query' in the sorted set by 1
      pipeline.zIncrBy(REDIS_TRENDING_1H, 1, query);
      pipeline.expire(REDIS_TRENDING_1H, Math.floor(config.TRENDING_WINDOW_1H_MS / 1000));
      pipeline.zIncrBy(REDIS_TRENDING_24H, 1, query);
      pipeline.expire(REDIS_TRENDING_24H, Math.floor(config.TRENDING_WINDOW_24H_MS / 1000));
      pipeline.exec().catch(err =>
        console.error('[TrendingService] Redis recordSearch error:', err.message),
      );
    }
  }

  // ─── Counting ────────────────────────────────────────────────────────────────

  /**
   * Count how many times `query` was searched within the last `windowMs` milliseconds.
   */
  getRecentCount(query, windowMs) {
    const cutoff = Date.now() - windowMs;
    let count = 0;
    for (const [bucketTime, bucket] of this.buckets) {
      if (bucketTime >= cutoff) {
        count += bucket.get(query) || 0;
      }
    }
    return count;
  }

  // ─── Scoring ─────────────────────────────────────────────────────────────────

  /**
   * Compute a trending score for a query given its all-time DB count.
   *
   * Weights:
   * - 0.4 × all_time_count → ensures historically popular queries remain relevant
   * - 50  × count in last 1h → heavily rewards very recent spikes
   * - 10  × count in last 24h → rewards sustained daily interest
   */
  computeTrendingScore(query, allTimeCount) {
    const recent1h = this.getRecentCount(query, config.TRENDING_WINDOW_1H_MS);
    const recent24h = this.getRecentCount(query, config.TRENDING_WINDOW_24H_MS);
    return (allTimeCount * 0.4) + (recent1h * 50) + (recent24h * 10);
  }

  /**
   * Enrich a list of suggestions with trending scores and re-sort.
   * @param {Array<{query: string, count: number}>} suggestions
   * @returns {Array<{query: string, count: number, trending_score: number}>}
   */
  enrichWithTrendingScores(suggestions) {
    return suggestions
      .map(s => ({
        ...s,
        trending_score: Math.round(this.computeTrendingScore(s.query, s.count)),
      }))
      .sort((a, b) => b.trending_score - a.trending_score);
  }

  /**
   * Get overall trending queries across all in-memory buckets (for the trending panel).
   * @param {number} limit
   * @returns {Array<{query: string, recent_count: number}>}
   */
  getGlobalTrending(limit = 10) {
    const cutoff = Date.now() - config.TRENDING_WINDOW_1H_MS;
    const totals = new Map();

    for (const [bucketTime, bucket] of this.buckets) {
      if (bucketTime >= cutoff) {
        for (const [query, count] of bucket) {
          totals.set(query, (totals.get(query) || 0) + count);
        }
      }
    }

    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([query, recent_count]) => ({ query, recent_count }));
  }

  // ─── Hydration ───────────────────────────────────────────────────────────────

  /**
   * Hydrate in-memory buckets from Redis sorted sets on startup.
   *
   * Reads the 1h and 24h trending sorted sets from Redis and replays them into
   * the current minute bucket. This is an approximation (the original per-minute
   * distribution is not preserved), but it ensures trending data survives restarts.
   */
  async hydrateFromRedis() {
    if (!isReady()) return;

    try {
      const redis = getRedisClient();

      // Read the 1h sorted set (highest scores first)
      const entries1h = await redis.zRangeWithScores(REDIS_TRENDING_1H, 0, -1);
      // Read the 24h sorted set
      const entries24h = await redis.zRangeWithScores(REDIS_TRENDING_24H, 0, -1);

      if (entries1h.length === 0 && entries24h.length === 0) {
        console.log('[TrendingService] No Redis trending data to hydrate');
        return;
      }

      // Merge into a single current-minute bucket (approximation)
      const nowBucket = Math.floor(Date.now() / 60000) * 60000;
      if (!this.buckets.has(nowBucket)) {
        this.buckets.set(nowBucket, new Map());
      }
      const bucket = this.buckets.get(nowBucket);

      // Use max of 1h and 24h counts for each query
      const combined = new Map();
      for (const { value: query, score } of entries24h) {
        combined.set(query, Math.round(score));
      }
      for (const { value: query, score } of entries1h) {
        // 1h is a subset of 24h — use the larger count to avoid double-counting
        combined.set(query, Math.max(combined.get(query) || 0, Math.round(score)));
      }

      for (const [query, count] of combined) {
        bucket.set(query, (bucket.get(query) || 0) + count);
      }

      console.log(`[TrendingService] Hydrated ${combined.size} trending queries from Redis`);
    } catch (err) {
      console.error('[TrendingService] Redis hydration error:', err.message);
    }
  }

  // ─── Maintenance ─────────────────────────────────────────────────────────────

  /**
   * Remove buckets older than 24 hours to prevent unbounded memory growth.
   */
  _pruneOldBuckets() {
    const cutoff = Date.now() - config.TRENDING_WINDOW_24H_MS;
    let pruned = 0;
    for (const [bucketTime] of this.buckets) {
      if (bucketTime < cutoff) {
        this.buckets.delete(bucketTime);
        pruned++;
      }
    }
    if (pruned > 0) {
      console.log(`[TrendingService] Pruned ${pruned} old time buckets`);
    }
  }

  destroy() {
    clearInterval(this._pruneInterval);
  }
}

// Singleton
let instance = null;
function getTrendingService() {
  if (!instance) instance = new TrendingService();
  return instance;
}

module.exports = { TrendingService, getTrendingService };
