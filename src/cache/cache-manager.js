/**
 * Distributed Cache Manager — L1 (in-process) + L2 (Redis).
 *
 * Lookup order:
 *   1. L1 — CacheNode LRU inside this process (~0ms, zero network)
 *   2. L2 — Redis GET (~1ms, survives restarts, shared across processes)
 *   3. miss — caller queries the DB
 *
 * Store order (on DB miss):
 *   1. Store in Redis (L2) with a longer TTL (default 5 min)
 *   2. Store in the appropriate L1 node (shorter TTL, default 1 min)
 *
 * Invalidation:
 *   - L1: exact key + all shorter parent prefixes
 *   - L2: SCAN + DEL on `suggest:<prefix>*` pattern
 *
 * All public cache methods (lookup / store / invalidatePrefix) are async
 * because Redis calls are async. L1 operations are still synchronous internally.
 */

const ConsistentHashRing = require('./consistent-hash');
const CacheNode = require('./cache-node');
const { isReady, getRedisClient } = require('./redis-client');
const config = require('../config');

/** Redis key prefix for suggestion cache entries */
const REDIS_KEY_PREFIX = 'suggest:';

class CacheManager {
  /**
   * @param {object} opts
   * @param {number} opts.numNodes - Number of cache nodes (default 4)
   * @param {number} opts.virtualNodes - Virtual nodes per physical node (default 150)
   * @param {number} opts.maxSize - Max entries per node
   * @param {number} opts.ttlSeconds - Cache entry TTL
   */
  constructor({
    numNodes = config.CACHE_NODES,
    virtualNodes = config.CACHE_VIRTUAL_NODES,
    maxSize = config.CACHE_MAX_SIZE,
    ttlSeconds = config.CACHE_TTL_SECONDS,
  } = {}) {
    this.ring = new ConsistentHashRing(virtualNodes);
    /** @type {Map<string, CacheNode>} */
    this.nodes = new Map();

    // Create and register N cache nodes
    for (let i = 0; i < numNodes; i++) {
      const nodeId = `cache-node-${i}`;
      const node = new CacheNode(nodeId, { maxSize, ttlSeconds });
      this.nodes.set(nodeId, node);
      this.ring.addNode(nodeId);
    }

    console.log(`[CacheManager] Initialized ${numNodes} nodes, ${virtualNodes} virtual nodes each`);
    console.log(`[CacheManager] Ring distribution:`, this.ring.getDistribution());
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  _getNodeForKey(key) {
    const nodeId = this.ring.getNode(key);
    return this.nodes.get(nodeId);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Look up cached suggestions for a prefix.
   * Checks L1 first, then L2 (Redis).
   *
   * @param {string} prefix
   * @returns {Promise<Array|null>} suggestions array, or null on cache miss
   */
  async lookup(prefix) {
    // 1. L1 lookup (synchronous, in-process)
    const node = this._getNodeForKey(prefix);
    if (node) {
      const l1Result = node.get(prefix);
      if (l1Result !== null) return l1Result;
    }

    // 2. L2 lookup (Redis)
    if (isReady()) {
      try {
        const redis = getRedisClient();
        const raw = await redis.get(`${REDIS_KEY_PREFIX}${prefix}`);
        if (raw !== null) {
          const parsed = JSON.parse(raw);
          // Populate L1 so subsequent requests skip Redis
          if (node) node.set(prefix, parsed);
          return parsed;
        }
      } catch (err) {
        console.error('[CacheManager] Redis lookup error:', err.message);
      }
    }

    return null;
  }

  /**
   * Store suggestions for a prefix in L1 and L2.
   *
   * @param {string} prefix
   * @param {Array} suggestions
   * @param {number} [ttlMs] - Optional L1 TTL override (ms)
   */
  async store(prefix, suggestions, ttlMs) {
    // 1. Store in L1
    const node = this._getNodeForKey(prefix);
    if (node) node.set(prefix, suggestions, ttlMs);

    // 2. Store in Redis (L2) with configurable TTL
    if (isReady()) {
      try {
        const redis = getRedisClient();
        await redis.set(
          `${REDIS_KEY_PREFIX}${prefix}`,
          JSON.stringify(suggestions),
          { EX: config.REDIS_TTL_SECONDS },
        );
      } catch (err) {
        console.error('[CacheManager] Redis store error:', err.message);
      }
    }
  }

  /**
   * Invalidate cached entry for an exact prefix and all parent prefixes.
   * Removes from L1 and L2 (Redis SCAN + DEL).
   */
  async invalidatePrefix(prefix) {
    // ── L1 invalidation (synchronous) ──────────────────────────────────────
    const owningNode = this._getNodeForKey(prefix);
    if (owningNode) owningNode.invalidate(prefix);

    // Also invalidate shorter parent prefixes
    for (let len = 1; len < prefix.length; len++) {
      const parentPrefix = prefix.slice(0, len);
      const parentNode = this._getNodeForKey(parentPrefix);
      if (parentNode) parentNode.invalidate(parentPrefix);
    }

    // ── L2 invalidation (Redis SCAN + DEL) ────────────────────────────────
    if (isReady()) {
      try {
        const redis = getRedisClient();
        // Collect all matching keys via SCAN (non-blocking, paginated)
        const pattern = `${REDIS_KEY_PREFIX}${prefix}*`;
        const keysToDelete = [];
        for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
          keysToDelete.push(key);
        }
        // Also delete parent prefix keys
        for (let len = 1; len < prefix.length; len++) {
          keysToDelete.push(`${REDIS_KEY_PREFIX}${prefix.slice(0, len)}`);
        }
        if (keysToDelete.length > 0) {
          await redis.del(keysToDelete);
        }
      } catch (err) {
        console.error('[CacheManager] Redis invalidation error:', err.message);
      }
    }
  }

  /**
   * Get debug info for a specific prefix — which node owns it, hit/miss.
   * @param {string} prefix
   * @returns {object}
   */
  debugInfo(prefix) {
    const nodeId = this.ring.getNode(prefix);
    const node = this.nodes.get(nodeId);
    const position = this.ring.getPosition(prefix);
    const cached = node ? node.get(prefix) : null;

    return {
      prefix,
      ring_position: position,
      owning_node: nodeId,
      cache_hit: cached !== null,
      cached_count: cached ? cached.length : 0,
      cached_preview: cached ? cached.slice(0, 3).map(s => s.query) : [],
      node_stats: node ? node.stats() : null,
      all_node_stats: this.allStats(),
      ring_distribution: this.ring.getDistribution(),
      redis_ready: isReady(),
    };
  }

  /**
   * Get stats for all nodes.
   */
  allStats() {
    const stats = {};
    for (const [id, node] of this.nodes) {
      stats[id] = node.stats();
    }
    return stats;
  }

  /**
   * Add a new cache node to the ring (demonstrates node addition).
   */
  addNode(nodeId) {
    if (this.nodes.has(nodeId)) return;
    const node = new CacheNode(nodeId, {
      maxSize: config.CACHE_MAX_SIZE,
      ttlSeconds: config.CACHE_TTL_SECONDS,
    });
    this.nodes.set(nodeId, node);
    this.ring.addNode(nodeId);
    console.log(`[CacheManager] Added node: ${nodeId}`);
  }

  /**
   * Remove a cache node from the ring (demonstrates graceful removal).
   */
  removeNode(nodeId) {
    this.ring.removeNode(nodeId);
    this.nodes.delete(nodeId);
    console.log(`[CacheManager] Removed node: ${nodeId}`);
  }
}

// Singleton instance
let instance = null;

function getCacheManager() {
  if (!instance) {
    instance = new CacheManager();
  }
  return instance;
}

module.exports = { CacheManager, getCacheManager };
