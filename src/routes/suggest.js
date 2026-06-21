const express = require('express');
const { getSuggestions } = require('../services/suggestion-service');

const router = express.Router();

/**
 * GET /suggest?q=<prefix>
 *
 * Returns top search suggestions for the given prefix.
 *
 * Query params:
 *   q (string, required): the search prefix typed by the user
 *
 * Response:
 *   200: { suggestions: [{query, count, trending_score}...], source: 'cache'|'db', latency_ms }
 *   400: { error: 'Missing q parameter' }
 */
router.get('/', async (req, res) => {
  const prefix = req.query.q;

  if (prefix === undefined) {
    return res.status(400).json({ error: 'Missing q parameter' });
  }

  try {
    const result = await getSuggestions(prefix);

    // Expose latency as a response header for the frontend to display
    res.set('X-Response-Time', `${result.latencyMs}ms`);
    res.set('X-Cache-Source', result.source);

    return res.json({
      query: prefix,
      suggestions: result.suggestions,
      source: result.source,
      latency_ms: result.latencyMs,
    });
  } catch (err) {
    console.error('[suggest route] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
