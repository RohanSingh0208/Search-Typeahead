/**
 * All database query functions.
 * Uses Node.js 22 built-in node:sqlite (DatabaseSync).
 * Transactions implemented via BEGIN/COMMIT since db.transaction() is not yet available.
 */

const { getDb } = require('./init');

// ─── Suggestions ──────────────────────────────────────────────────────────────

/**
 * Get top N suggestions matching a prefix, ordered by count descending.
 */
function getTopSuggestions(prefix, limit = 10) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT query, count, last_searched
    FROM   queries
    WHERE  query LIKE ? ESCAPE '\\'
    ORDER  BY count DESC
    LIMIT  ?
  `);
  const escapedPrefix = prefix.replace(/[%_\\]/g, '\\$&');
  return stmt.all(`${escapedPrefix}%`, limit);
}

/**
 * Get recent queries for trending computation.
 */
function getRecentQueries(sinceMs, limit = 50) {
  const db = getDb();
  const since = Date.now() - sinceMs;
  const stmt = db.prepare(`
    SELECT query, count, last_searched
    FROM   queries
    WHERE  last_searched >= ?
    ORDER  BY last_searched DESC
    LIMIT  ?
  `);
  return stmt.all(since, limit);
}

// ─── Writes ───────────────────────────────────────────────────────────────────

/**
 * Upsert a single query.
 */
function upsertQuery(query, delta = 1) {
  const db = getDb();
  db.prepare(`
    INSERT INTO queries (query, count, last_searched)
    VALUES (?, ?, ?)
    ON CONFLICT (query) DO UPDATE SET
      count         = count + excluded.count,
      last_searched = excluded.last_searched
  `).run(query, delta, Date.now());
}

/**
 * Batch upsert many queries in a single transaction.
 * @param {Array<{query: string, count: number, last_searched: number}>} entries
 */
function batchUpsert(entries) {
  if (!entries || entries.length === 0) return;

  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO queries (query, count, last_searched)
    VALUES (?, ?, ?)
    ON CONFLICT (query) DO UPDATE SET
      count         = count + excluded.count,
      last_searched = MAX(last_searched, excluded.last_searched)
  `);

  db.exec('BEGIN TRANSACTION');
  try {
    for (const { query, count, last_searched } of entries) {
      stmt.run(query, count, last_searched);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Bulk insert from dataset (seeding). Ignores conflicts.
 */
function bulkInsert(entries) {
  const db = getDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO queries (query, count) VALUES (?, ?)');

  db.exec('BEGIN TRANSACTION');
  try {
    for (const [query, count] of entries) {
      stmt.run(query, count);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Get total row count.
 */
function getTotalCount() {
  const db = getDb();
  return db.prepare('SELECT COUNT(*) as cnt FROM queries').get().cnt;
}

module.exports = {
  getTopSuggestions,
  getRecentQueries,
  upsertQuery,
  batchUpsert,
  bulkInsert,
  getTotalCount,
};
