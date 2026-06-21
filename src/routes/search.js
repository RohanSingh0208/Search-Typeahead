const express = require('express');
const { submitSearch } = require('../services/search-service');

const router = express.Router();

/**
 * POST /search
 *
 * Submit a search query. Increments the query count and updates trending.
 *
 * Body (JSON):
 *   { query: string }
 *
 * Response:
 *   200: { message: 'Searched', query: string }
 *   400: { error: string }
 */
router.post('/', (req, res) => {
  const { query } = req.body || {};

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Body must contain a "query" string field' });
  }

  try {
    const result = submitSearch(query);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
