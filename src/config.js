require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT) || 3000,
  DB_PATH: process.env.DB_PATH || './data/typeahead.db',

  // Cache configuration
  CACHE_NODES: parseInt(process.env.CACHE_NODES) || 4,
  CACHE_VIRTUAL_NODES: parseInt(process.env.CACHE_VIRTUAL_NODES) || 150,
  CACHE_TTL_SECONDS: parseInt(process.env.CACHE_TTL_SECONDS) || 60,
  CACHE_MAX_SIZE: parseInt(process.env.CACHE_MAX_SIZE) || 1000,

  // Redis configuration (L2 cache + trending persistence)
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  REDIS_TTL_SECONDS: parseInt(process.env.REDIS_TTL_SECONDS) || 300, // 5 min (longer than L1)
  REDIS_ENABLED: process.env.REDIS_ENABLED !== 'false', // default true; set to 'false' to disable

  // Batch writer configuration
  BATCH_FLUSH_INTERVAL_MS: parseInt(process.env.BATCH_FLUSH_INTERVAL_MS) || 5000,
  BATCH_MAX_SIZE: parseInt(process.env.BATCH_MAX_SIZE) || 100,

  // Suggestion configuration
  SUGGESTION_LIMIT: parseInt(process.env.SUGGESTION_LIMIT) || 10,

  // Trending windows
  TRENDING_WINDOW_1H_MS: parseInt(process.env.TRENDING_WINDOW_1H_MS) || 3_600_000,
  TRENDING_WINDOW_24H_MS: parseInt(process.env.TRENDING_WINDOW_24H_MS) || 86_400_000,
  TRENDING_PRUNE_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
};
