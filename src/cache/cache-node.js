/**
 * Individual Cache Node with LRU eviction and TTL-based expiry.
 *
 * Data structure: doubly-linked list + Map for O(1) get/set/delete.
 * - Map: key → ListNode (for O(1) lookup)
 * - Doubly-linked list: MRU at head, LRU at tail (for O(1) eviction)
 */

class ListNode {
  constructor(key, value, expiresAt) {
    this.key = key;
    this.value = value;
    this.expiresAt = expiresAt;
    this.prev = null;
    this.next = null;
  }
}

class CacheNode {
  /**
   * @param {string} nodeId - Identifier for this cache node
   * @param {object} opts
   * @param {number} opts.maxSize - Max number of entries (default 1000)
   * @param {number} opts.ttlSeconds - Default TTL in seconds (default 60)
   */
  constructor(nodeId, { maxSize = 1000, ttlSeconds = 60 } = {}) {
    this.nodeId = nodeId;
    this.maxSize = maxSize;
    this.defaultTtlMs = ttlSeconds * 1000;

    /** @type {Map<string, ListNode>} */
    this.map = new Map();

    // Sentinel head (MRU) and tail (LRU) nodes
    this.head = new ListNode(null, null, null);
    this.tail = new ListNode(null, null, null);
    this.head.next = this.tail;
    this.tail.prev = this.head;

    // Stats
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.expirations = 0;
  }

  // ─── Linked List Helpers ────────────────────────────────────────────────────

  _addToFront(node) {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next.prev = node;
    this.head.next = node;
  }

  _removeNode(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  _moveToFront(node) {
    this._removeNode(node);
    this._addToFront(node);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Get cached value for key.
   * Returns null on miss or if the entry has expired.
   */
  get(key) {
    const node = this.map.get(key);
    if (!node) {
      this.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() > node.expiresAt) {
      this._removeNode(node);
      this.map.delete(key);
      this.expirations++;
      this.misses++;
      return null;
    }

    // Move to front (most recently used)
    this._moveToFront(node);
    this.hits++;
    return node.value;
  }

  /**
   * Store a value in the cache.
   * @param {string} key
   * @param {*} value
   * @param {number} [ttlMs] - Override TTL in milliseconds
   */
  set(key, value, ttlMs) {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);

    if (this.map.has(key)) {
      // Update existing entry
      const node = this.map.get(key);
      node.value = value;
      node.expiresAt = expiresAt;
      this._moveToFront(node);
      return;
    }

    // Create new entry
    const node = new ListNode(key, value, expiresAt);
    this.map.set(key, node);
    this._addToFront(node);

    // Evict LRU if over capacity
    if (this.map.size > this.maxSize) {
      const lru = this.tail.prev;
      this._removeNode(lru);
      this.map.delete(lru.key);
      this.evictions++;
    }
  }

  /**
   * Remove a specific key from the cache.
   */
  invalidate(key) {
    const node = this.map.get(key);
    if (node) {
      this._removeNode(node);
      this.map.delete(key);
      return true;
    }
    return false;
  }

  /**
   * Remove all keys that start with a given prefix (for cache invalidation after search).
   */
  invalidatePrefix(prefix) {
    let count = 0;
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        this.invalidate(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all entries.
   */
  clear() {
    this.map.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /**
   * Return stats for this node.
   */
  stats() {
    const total = this.hits + this.misses;
    return {
      nodeId: this.nodeId,
      size: this.map.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? ((this.hits / total) * 100).toFixed(1) + '%' : 'N/A',
      evictions: this.evictions,
      expirations: this.expirations,
    };
  }
}

module.exports = CacheNode;
