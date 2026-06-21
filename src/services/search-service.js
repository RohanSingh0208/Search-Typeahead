/**
 * Search submission service.
 * Validates, normalizes, then enqueues into batch writer + trending tracker.
 */

const { getBatchWriter } = require('./batch-writer');
const { getTrendingService } = require('./trending-service');
const { normalizePrefix } = require('./suggestion-service');

/**
 * Submit a search query.
 * @param {string} rawQuery
 * @returns {{ query: string, message: string }}
 */
function submitSearch(rawQuery) {
  const query = normalizePrefix(rawQuery);

  if (!query || query.length < 1) {
    throw new Error('Query must be at least 1 character');
  }
  if (query.length > 200) {
    throw new Error('Query too long (max 200 characters)');
  }

  const timestamp = Date.now();

  // 1. Record in trending service (in-memory, immediate)
  getTrendingService().recordSearch(query, timestamp);

  // 2. Enqueue in batch writer (async DB write)
  getBatchWriter().enqueue(query, timestamp);

  return { query, message: 'Searched' };
}

module.exports = { submitSearch };
