/**
 * Batch Write Service.
 *
 * Problem: If we write to the DB on every search submission, we get:
 *   - High write pressure (thousands of individual INSERT/UPDATE per minute)
 *   - Lock contention on the queries table
 *   - Disk I/O amplification for popular queries that get searched many times/second
 *
 * Solution: Buffer writes in memory, aggregate duplicates, and flush in batches.
 *
 * Guarantees:
 * - Eventually consistent: every submitted search WILL reach the DB (within flush interval)
 * - Aggregation: 100 searches for "iphone" in 5s = 1 DB write (count += 100)
 * - Graceful shutdown: remaining buffer is flushed on SIGINT/SIGTERM
 *
 * Failure scenario:
 * - On process crash (SIGKILL), buffered writes since the last flush are lost.
 * - Mitigation in production: write to a WAL (Write-Ahead Log) on disk first.
 *   Here we log a warning documenting this trade-off.
 */

const { batchUpsert } = require('../db/queries');
const { getCacheManager } = require('../cache/cache-manager');
const { getTrendingService } = require('./trending-service');
const config = require('../config');

class BatchWriter {
  constructor({
    flushIntervalMs = config.BATCH_FLUSH_INTERVAL_MS,
    maxBufferSize = config.BATCH_MAX_SIZE,
  } = {}) {
    this.flushIntervalMs = flushIntervalMs;
    this.maxBufferSize = maxBufferSize;

    /**
     * Buffer: Map<query, { count: number, lastTimestamp: number }>
     * Multiple submissions of the same query are aggregated here.
     */
    this.buffer = new Map();

    // Metrics
    this.totalSearchesReceived = 0;
    this.totalDbWrites = 0;
    this.totalFlushes = 0;
    this.totalEntriesFlushed = 0;

    // Start periodic flush
    this._flushTimer = setInterval(() => this.flush('periodic'), flushIntervalMs);
    this._flushTimer.unref();

    // Graceful shutdown
    this._shutdownHandler = () => {
      console.log('\n[BatchWriter] Shutdown detected — flushing remaining buffer...');
      this.flush('shutdown');
    };
    process.on('SIGINT', this._shutdownHandler);
    process.on('SIGTERM', this._shutdownHandler);

    console.log(`[BatchWriter] Started — flush every ${flushIntervalMs}ms, max buffer: ${maxBufferSize}`);
  }

  // ─── Add to Buffer ───────────────────────────────────────────────────────────

  /**
   * Record a search submission. Aggregates into the in-memory buffer.
   * @param {string} query - Normalized query string
   * @param {number} [timestamp] - When the search happened (default: now)
   */
  enqueue(query, timestamp = Date.now()) {
    this.totalSearchesReceived++;

    if (this.buffer.has(query)) {
      const entry = this.buffer.get(query);
      entry.count++;
      entry.lastTimestamp = Math.max(entry.lastTimestamp, timestamp);
    } else {
      this.buffer.set(query, { count: 1, lastTimestamp: timestamp });
    }

    // Size-based flush trigger
    if (this.buffer.size >= this.maxBufferSize) {
      this.flush('size-limit');
    }
  }

  // ─── Flush ───────────────────────────────────────────────────────────────────

  /**
   * Flush the current buffer to the database.
   * @param {string} reason - Why we're flushing (for logging)
   */
  flush(reason = 'manual') {
    if (this.buffer.size === 0) return;

    const snapshot = this.buffer;
    this.buffer = new Map(); // swap buffer atomically

    const entries = [...snapshot.entries()].map(([query, { count, lastTimestamp }]) => ({
      query,
      count,
      last_searched: lastTimestamp,
    }));

    try {
      batchUpsert(entries);

      // Invalidate cache for affected prefixes (so next suggest reflects new counts)
      const cache = getCacheManager();
      for (const { query } of entries) {
        cache.invalidatePrefix(query);
      }

      this.totalDbWrites += entries.length;
      this.totalFlushes++;
      this.totalEntriesFlushed += entries.length;

      const reduction = this.totalSearchesReceived > 0
        ? (((this.totalSearchesReceived - this.totalDbWrites) / this.totalSearchesReceived) * 100).toFixed(1)
        : '0';

      console.log(
        `[BatchWriter] Flushed ${entries.length} entries (reason: ${reason}) | ` +
        `Total writes reduced by ${reduction}% (${this.totalSearchesReceived} searches → ${this.totalDbWrites} DB writes)`
      );
    } catch (err) {
      // Put entries back in the buffer on failure (best-effort)
      console.error('[BatchWriter] Flush failed:', err.message);
      for (const { query, count, last_searched } of entries) {
        if (this.buffer.has(query)) {
          this.buffer.get(query).count += count;
        } else {
          this.buffer.set(query, { count, lastTimestamp: last_searched });
        }
      }
    }
  }

  // ─── Stats ───────────────────────────────────────────────────────────────────

  stats() {
    const writeReduction = this.totalSearchesReceived > 0
      ? (((this.totalSearchesReceived - this.totalDbWrites) / this.totalSearchesReceived) * 100).toFixed(1) + '%'
      : 'N/A';

    return {
      buffer_size: this.buffer.size,
      flush_interval_ms: this.flushIntervalMs,
      max_buffer_size: this.maxBufferSize,
      total_searches_received: this.totalSearchesReceived,
      total_db_writes: this.totalDbWrites,
      total_flushes: this.totalFlushes,
      write_reduction: writeReduction,
    };
  }

  destroy() {
    clearInterval(this._flushTimer);
    process.off('SIGINT', this._shutdownHandler);
    process.off('SIGTERM', this._shutdownHandler);
  }
}

// Singleton
let instance = null;
function getBatchWriter() {
  if (!instance) instance = new BatchWriter();
  return instance;
}

module.exports = { BatchWriter, getBatchWriter };
