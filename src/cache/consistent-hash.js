/**
 * Consistent Hashing Ring implementation.
 *
 * How it works:
 * - Each physical node is mapped to K virtual nodes on a circular ring [0, 2^32).
 * - When looking up a key, we hash it and find the first virtual node clockwise.
 * - This ensures ~even key distribution and minimal remapping when nodes change.
 *
 * Why consistent hashing?
 * - With a naive modulo approach (hash(key) % N), adding/removing a node
 *   would remap ~all keys, causing a cache thundering-herd problem.
 * - Consistent hashing limits remapping to ~K/N keys on average.
 */

const crypto = require('crypto');

class ConsistentHashRing {
  /**
   * @param {number} virtualNodes - Number of virtual nodes per physical node (default 150)
   */
  constructor(virtualNodes = 150) {
    this.virtualNodes = virtualNodes;
    /** @type {Map<number, string>} ring: hash position → physical node ID */
    this.ring = new Map();
    /** @type {number[]} sorted list of positions on the ring */
    this.sortedPositions = [];
    /** @type {Set<string>} physical node IDs */
    this.nodes = new Set();
  }

  // ─── Hash Function ──────────────────────────────────────────────────────────

  /**
   * FNV-1a 32-bit hash — fast, good distribution, deterministic.
   * Returns a number in [0, 2^32).
   */
  _hash(str) {
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 16777619) >>> 0; // FNV prime, force uint32
    }
    return hash;
  }

  // ─── Node Management ────────────────────────────────────────────────────────

  /**
   * Add a physical node to the ring, creating `virtualNodes` virtual positions.
   */
  addNode(nodeId) {
    if (this.nodes.has(nodeId)) return;
    this.nodes.add(nodeId);

    for (let i = 0; i < this.virtualNodes; i++) {
      const virtualKey = `${nodeId}:vn${i}`;
      const position = this._hash(virtualKey);
      this.ring.set(position, nodeId);
    }

    // Keep positions sorted for binary search
    this.sortedPositions = [...this.ring.keys()].sort((a, b) => a - b);
  }

  /**
   * Remove a physical node (and all its virtual nodes) from the ring.
   */
  removeNode(nodeId) {
    if (!this.nodes.has(nodeId)) return;
    this.nodes.delete(nodeId);

    for (let i = 0; i < this.virtualNodes; i++) {
      const virtualKey = `${nodeId}:vn${i}`;
      const position = this._hash(virtualKey);
      this.ring.delete(position);
    }

    this.sortedPositions = [...this.ring.keys()].sort((a, b) => a - b);
  }

  // ─── Lookup ─────────────────────────────────────────────────────────────────

  /**
   * Find the physical node responsible for a given key.
   * Uses binary search to find the first position >= hash(key) on the ring,
   * wrapping around to the first position if needed.
   *
   * @param {string} key
   * @returns {string} physical node ID, or null if ring is empty
   */
  getNode(key) {
    if (this.sortedPositions.length === 0) return null;

    const keyHash = this._hash(key);

    // Binary search: find first position >= keyHash
    let lo = 0;
    let hi = this.sortedPositions.length - 1;
    let result = 0; // wrap-around default

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.sortedPositions[mid] >= keyHash) {
        result = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    const position = this.sortedPositions[result];
    return this.ring.get(position);
  }

  /**
   * Get ring position (hash value) for a key — useful for debugging.
   */
  getPosition(key) {
    return this._hash(key);
  }

  /**
   * Return a summary of how keys are distributed across nodes.
   */
  getDistribution() {
    const dist = {};
    for (const nodeId of this.nodes) dist[nodeId] = 0;
    for (const nodeId of this.ring.values()) dist[nodeId]++;
    return dist;
  }
}

module.exports = ConsistentHashRing;
