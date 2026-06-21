/**
 * SQLite database initialization using Node.js 22 built-in `node:sqlite`.
 * No native compilation required — works out of the box on Node 22+.
 *
 * Enable with: node --experimental-sqlite
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const config = require('../config');

let db;

function getDb() {
  if (!db) {
    const dbDir = path.dirname(config.DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new DatabaseSync(config.DB_PATH);

    // WAL mode for better concurrent reads
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA cache_size = -64000'); // 64MB cache
    db.exec('PRAGMA temp_store = MEMORY');

    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS queries (
      query         TEXT    PRIMARY KEY,
      count         INTEGER NOT NULL DEFAULT 0,
      last_searched INTEGER,
      created_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_query_prefix   ON queries (query);
    CREATE INDEX IF NOT EXISTS idx_last_searched  ON queries (last_searched DESC);
  `);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
