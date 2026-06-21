const express = require('express');
const { getCacheManager } = require('../cache/cache-manager');
const { getTrendingService } = require('../services/trending-service');
const { getBatchWriter } = require('../services/batch-writer');

const router = express.Router();

/**
 * GET /cache/debug?prefix=<prefix>
 *
 * Debug endpoint: shows which cache node owns a prefix, hit/miss, and full stats.
 *
 * Query params:
 *   prefix (string): the prefix to inspect
 *
 * Response: detailed cache debug information
 */
router.get('/debug', (req, res) => {
  const prefix = (req.query.prefix || '').toLowerCase().trim();
  const cache = getCacheManager();

  const info = cache.debugInfo(prefix || '_global_');

  return res.json({
    timestamp: new Date().toISOString(),
    inspected_prefix: prefix,
    ...info,
  });
});

/**
 * GET /cache/stats
 * Overall stats for all cache nodes.
 */
router.get('/stats', (req, res) => {
  const cache = getCacheManager();
  return res.json({
    timestamp: new Date().toISOString(),
    nodes: cache.allStats(),
    ring_distribution: cache.ring.getDistribution(),
  });
});

/**
 * GET /metrics
 * System-wide metrics: cache, batch writer, trending.
 */
router.get('/metrics', (req, res) => {
  const cache = getCacheManager();
  const batch = getBatchWriter();
  const trending = getTrendingService();

  // Aggregate cache stats
  const nodeStats = cache.allStats();
  let totalHits = 0, totalMisses = 0;
  for (const s of Object.values(nodeStats)) {
    totalHits += s.hits;
    totalMisses += s.misses;
  }
  const totalRequests = totalHits + totalMisses;

  return res.json({
    timestamp: new Date().toISOString(),
    cache: {
      nodes: nodeStats,
      aggregate: {
        total_hits: totalHits,
        total_misses: totalMisses,
        hit_rate: totalRequests > 0 ? ((totalHits / totalRequests) * 100).toFixed(1) + '%' : 'N/A',
      },
      ring_distribution: cache.ring.getDistribution(),
    },
    batch_writer: batch.stats(),
    trending_now: trending.getGlobalTrending(10),
  });
});

module.exports = router;
