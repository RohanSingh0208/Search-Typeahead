/**
 * Redis Client — singleton wrapper around node-redis v4.
 *
 * Design decisions:
 * - Graceful fallback: if Redis is unreachable, `isReady()` returns false and
 *   callers fall back to the in-process L1 cache. The server keeps running.
 * - All public methods are safe to call even when Redis is not connected;
 *   they return null/undefined instead of throwing.
 * - Set REDIS_ENABLED=false in .env to disable Redis entirely (useful in CI).
 */

const { createClient } = require('redis');
const config = require('../config');

let client = null;
let _ready = false;

/**
 * Connect the Redis client. Called once from server.js during startup.
 * Resolves when connected (or immediately if disabled/failed in graceful mode).
 */
async function connectRedis() {
  if (!config.REDIS_ENABLED) {
    console.log('[Redis] Disabled via REDIS_ENABLED=false — using L1 cache only');
    return;
  }

  client = createClient({ url: config.REDIS_URL });

  client.on('connect', () => console.log(`[Redis] Connecting to ${config.REDIS_URL}...`));
  client.on('ready', () => {
    _ready = true;
    console.log('[Redis] ✅ Connected and ready');
  });
  client.on('error', (err) => {
    if (_ready) console.error('[Redis] Error:', err.message);
  });
  client.on('end', () => {
    _ready = false;
    console.log('[Redis] Connection closed');
  });
  client.on('reconnecting', () => console.log('[Redis] Reconnecting...'));

  try {
    await client.connect();
  } catch (err) {
    console.warn(`[Redis] ⚠️  Could not connect (${err.message}) — falling back to L1 cache only`);
    _ready = false;
  }
}

/**
 * Gracefully disconnect Redis. Called on server shutdown.
 */
async function disconnectRedis() {
  if (client && _ready) {
    try {
      await client.quit();
      console.log('[Redis] Disconnected');
    } catch (err) {
      console.error('[Redis] Error during disconnect:', err.message);
    }
  }
}

/** @returns {boolean} whether Redis is connected and ready */
function isReady() {
  return _ready && client !== null;
}

/** @returns {import('redis').RedisClientType|null} */
function getRedisClient() {
  return client;
}

module.exports = { connectRedis, disconnectRedis, isReady, getRedisClient };
