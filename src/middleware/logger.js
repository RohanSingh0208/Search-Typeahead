/**
 * Request logger middleware with latency tracking and p95 computation.
 */

const WINDOW_SIZE = 1000; // keep last 1000 latencies for percentile computation
const latencies = [];

function logger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const ms = Date.now() - start;
    latencies.push(ms);
    if (latencies.length > WINDOW_SIZE) latencies.shift();

    const color = res.statusCode >= 500 ? '\x1b[31m'  // red
      : res.statusCode >= 400 ? '\x1b[33m'            // yellow
      : res.statusCode >= 300 ? '\x1b[36m'            // cyan
      : '\x1b[32m';                                   // green
    const reset = '\x1b[0m';

    console.log(
      `${color}${res.statusCode}${reset} ${req.method} ${req.path} — ${ms}ms`
    );
  });

  next();
}

function getPercentile(pct) {
  if (latencies.length === 0) return null;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function getLatencyStats() {
  if (latencies.length === 0) return null;
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    avg_ms: Math.round(sum / sorted.length),
    p50_ms: getPercentile(50),
    p95_ms: getPercentile(95),
    p99_ms: getPercentile(99),
    min_ms: sorted[0],
    max_ms: sorted[sorted.length - 1],
  };
}

module.exports = { logger, getLatencyStats };
