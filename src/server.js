/**
 * Express server entry point for the Search Typeahead System.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const config = require('./config');
const { getDb, closeDb } = require('./db/init');
const { logger, getLatencyStats } = require('./middleware/logger');
const { getCacheManager } = require('./cache/cache-manager');
const { getBatchWriter } = require('./services/batch-writer');
const { getTrendingService } = require('./services/trending-service');
const { connectRedis, disconnectRedis, isReady } = require('./cache/redis-client');

const suggestRouter = require('./routes/suggest');
const searchRouter = require('./routes/search');
const cacheRouter = require('./routes/cache-debug');

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(logger);

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../public')));

// ─── API Routes ────────────────────────────────────────────────────────────────

app.use('/suggest', suggestRouter);
app.use('/search', searchRouter);
app.use('/cache', cacheRouter);

// ─── System Routes ────────────────────────────────────────────────────────────

// GET /metrics — full system metrics
app.get('/metrics', (req, res) => {
  const cache = getCacheManager();
  const batch = getBatchWriter();
  const trending = getTrendingService();
  const latency = getLatencyStats();

  const nodeStats = cache.allStats();
  let totalHits = 0, totalMisses = 0;
  for (const s of Object.values(nodeStats)) {
    totalHits += s.hits;
    totalMisses += s.misses;
  }
  const totalRequests = totalHits + totalMisses;

  res.json({
    timestamp: new Date().toISOString(),
    latency: latency,
    cache: {
      nodes: nodeStats,
      aggregate: {
        total_hits: totalHits,
        total_misses: totalMisses,
        hit_rate: totalRequests > 0 ? ((totalHits / totalRequests) * 100).toFixed(1) + '%' : 'N/A',
      },
      ring_distribution: cache.ring.getDistribution(),
      redis_ready: isReady(),
    },
    batch_writer: batch.stats(),
    trending_now: trending.getGlobalTrending(10),
  });
});

// GET /trending — top trending queries right now
app.get('/trending', (req, res) => {
  const trending = getTrendingService();
  res.json({
    trending: trending.getGlobalTrending(15),
    timestamp: new Date().toISOString(),
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Catch-all → serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ─── Startup ──────────────────────────────────────────────────────────────────

async function start() {
  // Initialize DB (creates tables if needed)
  try {
    const db = getDb();
    const { getTotalCount } = require('./db/queries');
    const count = getTotalCount();
    console.log(`[DB] Connected — ${count.toLocaleString()} queries in database`);
    if (count === 0) {
      console.warn('[DB] ⚠️  Database is empty! Run: npm run setup');
    }
  } catch (err) {
    console.error('[DB] Failed to connect:', err.message);
    process.exit(1);
  }

  // Connect Redis (graceful — server continues even if Redis is down)
  await connectRedis();

  // Initialize singletons (triggers constructor logging)
  getCacheManager();
  getBatchWriter();

  // Hydrate trending data from Redis (must run after Redis connects and singleton is created)
  await getTrendingService().hydrateFromRedis();

  const server = app.listen(config.PORT, () => {
    console.log(`\n🚀 Search Typeahead running at http://localhost:${config.PORT}`);
    console.log(`   Frontend: http://localhost:${config.PORT}`);
    console.log(`   API docs: http://localhost:${config.PORT}/health`);
    console.log(`   Metrics:  http://localhost:${config.PORT}/metrics\n`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[Server] ${signal} received — shutting down gracefully...`);
    server.close(async () => {
      getBatchWriter().flush('shutdown');
      await disconnectRedis();
      closeDb();
      console.log('[Server] Closed. Goodbye!');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

start();

module.exports = app; // for testing
