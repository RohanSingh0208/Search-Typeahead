/**
 * Search Typeahead — Frontend Application
 *
 * Features:
 * - Debounced input (300ms) → GET /suggest?q=<prefix>
 * - Keyboard navigation (↑↓ Arrow, Enter, Escape, Tab)
 * - Highlighted prefix match in suggestions
 * - POST /search on submit
 * - Trending panel (auto-refreshes every 30s)
 * - Recent searches (localStorage-backed)
 * - Cache debug panel (Tab key when search is focused)
 * - Metrics modal
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const API = {
  suggest:  '/suggest',
  search:   '/search',
  trending: '/trending',
  metrics:  '/metrics',
  cacheDebug: '/cache/debug',
};

const DEBOUNCE_MS     = 300;
const TRENDING_POLL   = 30_000;
const MAX_RECENT      = 10;
const RECENT_STORAGE  = 'typeahead:recent';

// ─── State ────────────────────────────────────────────────────────────────────

let currentSuggestions = [];
let selectedIndex      = -1;
let debounceTimer      = null;
let lastQuery          = '';

// ─── DOM Elements ─────────────────────────────────────────────────────────────

const searchInput    = document.getElementById('search-input');
const searchBtn      = document.getElementById('search-btn');
const searchClear    = document.getElementById('search-clear');
const searchMeta     = document.getElementById('search-meta');
const suggestionList = document.getElementById('suggestions-list');
const searchBox      = suggestionList.closest('.search-box') || document.querySelector('.search-box');

const statSource   = document.getElementById('stat-source');
const statLatency  = document.getElementById('stat-latency');
const statCount    = document.getElementById('stat-count');

const trendingList = document.getElementById('trending-list');
const recentList   = document.getElementById('recent-list');
const clearRecent  = document.getElementById('clear-recent');

const debugGrid    = document.getElementById('debug-grid');

const metricsOverlay = document.getElementById('metrics-overlay');
const metricsBody    = document.getElementById('metrics-body');
const btnMetrics     = document.getElementById('btn-metrics');
const closeMetrics   = document.getElementById('close-metrics');
const btnCacheDebug  = document.getElementById('btn-cache-debug');

// ─── Utilities ────────────────────────────────────────────────────────────────

function debounce(fn, ms) {
  return (...args) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Highlight the prefix in a query string.
 * Returns HTML string with <mark> around the matched prefix.
 */
function highlightPrefix(query, prefix) {
  if (!prefix) return escapeHtml(query);
  const lower = query.toLowerCase();
  const idx   = lower.indexOf(prefix.toLowerCase());
  if (idx < 0) return escapeHtml(query);
  const before = escapeHtml(query.slice(0, idx));
  const match  = escapeHtml(query.slice(idx, idx + prefix.length));
  const after  = escapeHtml(query.slice(idx + prefix.length));
  return `${before}<mark>${match}</mark>${after}`;
}

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ─── Recent Searches (localStorage) ──────────────────────────────────────────

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_STORAGE)) || []; }
  catch { return []; }
}

function saveRecent(list) {
  localStorage.setItem(RECENT_STORAGE, JSON.stringify(list));
}

function addToRecent(query) {
  let list = loadRecent().filter(q => q !== query);
  list.unshift(query);
  list = list.slice(0, MAX_RECENT);
  saveRecent(list);
  renderRecentList();
}

function renderRecentList() {
  const list = loadRecent();
  if (list.length === 0) {
    recentList.innerHTML = '<li class="recent-placeholder">No recent searches yet</li>';
    return;
  }
  recentList.innerHTML = list.map(q => `
    <li class="recent-item" role="option" tabindex="-1" data-query="${escapeHtml(q)}">
      <svg class="suggestion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <span class="recent-query">${escapeHtml(q)}</span>
    </li>
  `).join('');

  recentList.querySelectorAll('.recent-item').forEach(item => {
    item.addEventListener('click', () => {
      searchInput.value = item.dataset.query;
      performSearch(item.dataset.query);
    });
  });
}

// ─── Suggestions Dropdown ────────────────────────────────────────────────────

function showDropdown() {
  suggestionList.hidden = false;
  document.querySelector('.search-box').setAttribute('aria-expanded', 'true');
}

function hideDropdown() {
  suggestionList.hidden = true;
  document.querySelector('.search-box').setAttribute('aria-expanded', 'false');
  selectedIndex = -1;
}

function renderSuggestions(suggestions, prefix) {
  currentSuggestions = suggestions;
  selectedIndex = -1;

  if (suggestions.length === 0) {
    suggestionList.innerHTML = `<li class="suggestion-empty">No suggestions for "<strong>${escapeHtml(prefix)}</strong>"</li>`;
    showDropdown();
    return;
  }

  suggestionList.innerHTML = suggestions.map((s, i) => {
    const score = s.trending_score ? formatNumber(Math.round(s.trending_score)) : formatNumber(s.count);
    const isTrending = s.trending_score && s.trending_score > s.count * 0.5;
    return `
      <li
        class="suggestion-item"
        id="suggestion-${i}"
        role="option"
        aria-selected="false"
        tabindex="-1"
        data-query="${escapeHtml(s.query)}"
        style="animation-delay: ${i * 30}ms"
      >
        <svg class="suggestion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <span class="suggestion-text">${highlightPrefix(s.query, prefix)}</span>
        ${isTrending ? '<span class="suggestion-trending">🔥</span>' : ''}
        <span class="suggestion-score">${score}</span>
      </li>
    `;
  }).join('');

  showDropdown();

  suggestionList.querySelectorAll('.suggestion-item').forEach((item, i) => {
    item.addEventListener('click', () => selectSuggestion(i));
    item.addEventListener('mouseenter', () => {
      setSelectedIndex(i);
    });
  });
}

function setSelectedIndex(idx) {
  const items = suggestionList.querySelectorAll('.suggestion-item');
  items.forEach((el, i) => {
    el.setAttribute('aria-selected', i === idx ? 'true' : 'false');
  });
  selectedIndex = idx;
}

function selectSuggestion(idx) {
  const s = currentSuggestions[idx];
  if (!s) return;
  searchInput.value = s.query;
  hideDropdown();
  performSearch(s.query);
}

// ─── API Calls ────────────────────────────────────────────────────────────────

async function fetchSuggestions(prefix) {
  if (!prefix.trim()) {
    hideDropdown();
    updateStats(null);
    return;
  }

  try {
    const res = await fetch(`${API.suggest}?q=${encodeURIComponent(prefix)}`);
    const data = await res.json();

    const source  = res.headers.get('X-Cache-Source') || data.source || 'db';
    const latency = res.headers.get('X-Response-Time') || `${data.latency_ms}ms`;

    renderSuggestions(data.suggestions || [], prefix);
    updateStats({ source, latency, count: (data.suggestions || []).length });
    updateSearchMeta(latency, source);

    // Update cache debug panel if open
    const debugPanel = document.getElementById('cache-debug-panel');
    if (debugPanel && debugPanel.open) {
      fetchCacheDebug(prefix);
    }
  } catch (err) {
    console.error('Suggest error:', err);
    updateStats(null);
  }
}

async function performSearch(query) {
  const q = (query || searchInput.value).trim();
  if (!q) return;

  hideDropdown();
  addToRecent(q);
  searchInput.value = q;
  updateSearchClear();

  try {
    const res = await fetch(API.search, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    });
    const data = await res.json();
    console.log('[Search]', data);

    // Animate search button
    searchBtn.textContent = '✓';
    searchBtn.style.background = 'linear-gradient(135deg, #10b981, #06b6d4)';
    setTimeout(() => {
      searchBtn.textContent = 'Search';
      searchBtn.style.background = '';
    }, 1500);

    // Refresh trending after a search
    setTimeout(fetchTrending, 500);
  } catch (err) {
    console.error('Search error:', err);
  }
}

async function fetchTrending() {
  try {
    const res = await fetch(API.trending);
    const data = await res.json();
    renderTrending(data.trending || []);
  } catch (err) {
    console.error('Trending error:', err);
  }
}

async function fetchMetrics() {
  metricsBody.innerHTML = '<div class="loading-shimmer">Loading metrics...</div>';
  try {
    const res = await fetch(API.metrics);
    const data = await res.json();
    renderMetrics(data);
  } catch (err) {
    metricsBody.innerHTML = '<p style="color: var(--red)">Failed to load metrics</p>';
  }
}

async function fetchCacheDebug(prefix) {
  const p = prefix || searchInput.value.trim().toLowerCase();
  if (!p) {
    debugGrid.innerHTML = '<p class="debug-hint">Type a search term first.</p>';
    return;
  }
  try {
    const res = await fetch(`${API.cacheDebug}?prefix=${encodeURIComponent(p)}`);
    const data = await res.json();
    renderCacheDebug(data);
  } catch (err) {
    debugGrid.innerHTML = `<p style="color:var(--red);padding:12px 18px">Error: ${err.message}</p>`;
  }
}

// ─── Render Functions ─────────────────────────────────────────────────────────

function updateStats(info) {
  if (!info) {
    statSource.querySelector('.stat-label').textContent = 'Waiting...';
    statSource.querySelector('.stat-dot').className = 'stat-dot empty';
    statLatency.querySelector('.stat-label').textContent = '—';
    statCount.querySelector('.stat-label').textContent = '—';
    return;
  }

  const dot = statSource.querySelector('.stat-dot');
  const srcLabel = statSource.querySelector('.stat-label');

  if (info.source === 'cache') {
    dot.className = 'stat-dot cache';
    srcLabel.textContent = '⚡ Cache Hit';
  } else if (info.source === 'db') {
    dot.className = 'stat-dot db';
    srcLabel.textContent = '🗄️ DB Query';
  } else {
    dot.className = 'stat-dot empty';
    srcLabel.textContent = info.source;
  }

  statLatency.querySelector('.stat-label').textContent = info.latency;
  statCount.querySelector('.stat-label').textContent = `${info.count} suggestions`;
}

function updateSearchMeta(latency, source) {
  searchMeta.textContent = `${latency} · ${source}`;
}

function renderTrending(trending) {
  if (!trending || trending.length === 0) {
    trendingList.innerHTML = '<li class="trending-placeholder">No trending searches yet — start searching!</li>';
    return;
  }

  trendingList.innerHTML = trending.map((item, i) => `
    <li class="trending-item" data-query="${escapeHtml(item.query)}" tabindex="0">
      <span class="trending-rank ${i < 3 ? 'top' : ''}">${i + 1}</span>
      <span class="trending-query">${escapeHtml(item.query)}</span>
      <span class="trending-count">${item.recent_count}</span>
    </li>
  `).join('');

  trendingList.querySelectorAll('.trending-item').forEach(item => {
    const handler = () => {
      searchInput.value = item.dataset.query;
      performSearch(item.dataset.query);
      searchInput.focus();
    };
    item.addEventListener('click', handler);
    item.addEventListener('keydown', e => { if (e.key === 'Enter') handler(); });
  });
}

function renderMetrics(data) {
  const cache = data.cache || {};
  const agg   = cache.aggregate || {};
  const batch  = data.batch_writer || {};
  const lat    = data.latency || {};
  const trending = data.trending_now || [];

  const nodeHtml = Object.entries(cache.nodes || {}).map(([id, s]) => `
    <div class="debug-node-card">
      <div class="debug-node-name">${id}</div>
      <div class="debug-node-stat">
        Size: ${s.size}/${s.maxSize}<br/>
        Hit Rate: ${s.hitRate}<br/>
        Hits: ${s.hits} | Misses: ${s.misses}<br/>
        Evictions: ${s.evictions}
      </div>
    </div>
  `).join('');

  const ringDist = cache.ring_distribution || {};
  const ringHtml = Object.entries(ringDist).map(([node, count]) => `
    <span style="color:var(--text-2);font-size:0.78rem">${node}: <strong style="color:var(--blue-light)">${count} vnodes</strong></span>
  `).join(' &nbsp;·&nbsp; ');

  const trendHtml = trending.length > 0
    ? trending.map((t, i) => `<span style="font-size:0.82rem;color:var(--text-2)">${i+1}. ${escapeHtml(t.query)} (${t.recent_count})</span>`).join('<br/>')
    : '<span style="color:var(--text-3)">No trending data yet</span>';

  metricsBody.innerHTML = `
    <div>
      <div class="metric-section-title">⏱ Latency</div>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">Avg</div><div class="metric-value blue">${lat.avg_ms ?? '—'}ms</div></div>
        <div class="metric-card"><div class="metric-label">p50</div><div class="metric-value">${lat.p50_ms ?? '—'}ms</div></div>
        <div class="metric-card"><div class="metric-label">p95</div><div class="metric-value yellow">${lat.p95_ms ?? '—'}ms</div></div>
        <div class="metric-card"><div class="metric-label">p99</div><div class="metric-value">${lat.p99_ms ?? '—'}ms</div></div>
      </div>
    </div>
    <div>
      <div class="metric-section-title">📦 Cache</div>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">Total Hits</div><div class="metric-value green">${agg.total_hits ?? 0}</div></div>
        <div class="metric-card"><div class="metric-label">Total Misses</div><div class="metric-value">${agg.total_misses ?? 0}</div></div>
        <div class="metric-card"><div class="metric-label">Hit Rate</div><div class="metric-value green">${agg.hit_rate ?? 'N/A'}</div></div>
      </div>
      <div class="debug-node-grid" style="margin-top:10px">${nodeHtml}</div>
      <div style="padding: 4px 0; font-size:0.78rem; color:var(--text-3)">Ring: ${ringHtml}</div>
    </div>
    <div>
      <div class="metric-section-title">✍️ Batch Writer</div>
      <div class="metric-grid">
        <div class="metric-card"><div class="metric-label">Searches Received</div><div class="metric-value">${batch.total_searches_received ?? 0}</div></div>
        <div class="metric-card"><div class="metric-label">DB Writes</div><div class="metric-value">${batch.total_db_writes ?? 0}</div></div>
        <div class="metric-card"><div class="metric-label">Write Reduction</div><div class="metric-value green">${batch.write_reduction ?? 'N/A'}</div></div>
        <div class="metric-card"><div class="metric-label">Buffer Size</div><div class="metric-value">${batch.buffer_size ?? 0}</div></div>
      </div>
    </div>
    <div>
      <div class="metric-section-title">🔥 Trending Now (1h)</div>
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;display:flex;flex-direction:column;gap:4px">
        ${trendHtml}
      </div>
    </div>
  `;
}

function renderCacheDebug(data) {
  const isHit = data.cache_hit;
  const nodeStats = data.node_stats || {};
  const dist = data.ring_distribution || {};

  const nodeCards = Object.entries(dist).map(([nodeId, vcount]) => {
    const isActive = nodeId === data.owning_node;
    const ns = data.all_node_stats ? data.all_node_stats[nodeId] : null;
    return `
      <div class="debug-node-card ${isActive ? 'active-node' : ''}">
        <div class="debug-node-name">${nodeId} ${isActive ? '← owns this prefix' : ''}</div>
        <div class="debug-node-stat">
          Virtual nodes: ${vcount}<br/>
          Cache size: ${ns ? ns.size : '—'}<br/>
          Hit rate: ${ns ? ns.hitRate : '—'}
        </div>
      </div>
    `;
  }).join('');

  debugGrid.innerHTML = `
    <div class="debug-grid" style="display:grid;gap:10px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
        <div class="debug-card">
          <div class="debug-card-title">Inspected Prefix</div>
          <div class="debug-card-value">"${escapeHtml(data.prefix || '')}"</div>
        </div>
        <div class="debug-card">
          <div class="debug-card-title">Ring Position</div>
          <div class="debug-card-value">${data.ring_position}</div>
        </div>
        <div class="debug-card">
          <div class="debug-card-title">Owning Node</div>
          <div class="debug-card-value">${data.owning_node}</div>
        </div>
        <div class="debug-card">
          <div class="debug-card-title">Cache Status</div>
          <div class="debug-card-value ${isHit ? 'hit' : 'miss'}">${isHit ? '✅ HIT' : '❌ MISS'}</div>
        </div>
        ${isHit ? `
        <div class="debug-card">
          <div class="debug-card-title">Cached Results</div>
          <div class="debug-card-value">${data.cached_count} suggestions</div>
        </div>
        ` : ''}
      </div>
      <div>
        <div class="debug-card-title" style="padding:0 0 6px">Cache Nodes</div>
        <div class="debug-node-grid">${nodeCards}</div>
      </div>
      ${isHit && data.cached_preview.length > 0 ? `
      <div class="debug-card">
        <div class="debug-card-title">Cached Preview</div>
        <div class="debug-card-value" style="font-size:0.78rem;line-height:1.8">
          ${data.cached_preview.map(q => escapeHtml(q)).join('<br/>')}
        </div>
      </div>
      ` : ''}
    </div>
  `;
}

// ─── Input Handling ───────────────────────────────────────────────────────────

function updateSearchClear() {
  searchClear.hidden = !searchInput.value;
}

const debouncedFetch = debounce(fetchSuggestions, DEBOUNCE_MS);

searchInput.addEventListener('input', () => {
  const q = searchInput.value;
  lastQuery = q;
  updateSearchClear();

  if (!q.trim()) {
    hideDropdown();
    updateStats(null);
    searchMeta.textContent = '';
    return;
  }
  debouncedFetch(q);
});

searchInput.addEventListener('keydown', (e) => {
  const items = suggestionList.querySelectorAll('.suggestion-item');

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (suggestionList.hidden) {
        debouncedFetch(searchInput.value);
        return;
      }
      setSelectedIndex(Math.min(selectedIndex + 1, items.length - 1));
      if (currentSuggestions[selectedIndex]) {
        searchInput.value = currentSuggestions[selectedIndex].query;
      }
      break;

    case 'ArrowUp':
      e.preventDefault();
      setSelectedIndex(Math.max(selectedIndex - 1, -1));
      if (selectedIndex === -1) {
        searchInput.value = lastQuery;
      } else if (currentSuggestions[selectedIndex]) {
        searchInput.value = currentSuggestions[selectedIndex].query;
      }
      break;

    case 'Enter':
      e.preventDefault();
      if (selectedIndex >= 0 && currentSuggestions[selectedIndex]) {
        selectSuggestion(selectedIndex);
      } else if (searchInput.value.trim()) {
        hideDropdown();
        performSearch(searchInput.value);
      }
      break;

    case 'Escape':
      hideDropdown();
      searchInput.value = lastQuery;
      searchInput.blur();
      break;

    case 'Tab':
      // Open cache debug panel for current prefix
      e.preventDefault();
      const panel = document.getElementById('cache-debug-panel');
      if (panel) {
        panel.open = true;
        fetchCacheDebug(searchInput.value.trim().toLowerCase());
        panel.scrollIntoView({ behavior: 'smooth' });
      }
      break;
  }
});

searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim() && currentSuggestions.length > 0) {
    showDropdown();
  }
});

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-container')) {
    hideDropdown();
  }
});

// Clear button
searchClear.addEventListener('click', () => {
  searchInput.value = '';
  lastQuery = '';
  updateSearchClear();
  hideDropdown();
  updateStats(null);
  searchMeta.textContent = '';
  searchInput.focus();
});

// Search button
searchBtn.addEventListener('click', () => {
  if (searchInput.value.trim()) {
    hideDropdown();
    performSearch(searchInput.value);
  }
});

// Clear recent
clearRecent.addEventListener('click', () => {
  saveRecent([]);
  renderRecentList();
});

// Metrics button
btnMetrics.addEventListener('click', () => {
  metricsOverlay.hidden = false;
  fetchMetrics();
});

closeMetrics.addEventListener('click', () => {
  metricsOverlay.hidden = true;
});

metricsOverlay.addEventListener('click', (e) => {
  if (e.target === metricsOverlay) metricsOverlay.hidden = true;
});

// Cache debug button (nav)
btnCacheDebug.addEventListener('click', () => {
  const panel = document.getElementById('cache-debug-panel');
  if (panel) {
    panel.open = !panel.open;
    if (panel.open) {
      fetchCacheDebug(searchInput.value.trim().toLowerCase());
      panel.scrollIntoView({ behavior: 'smooth' });
    }
  }
});

// ─── Initialization ───────────────────────────────────────────────────────────

function init() {
  // Load recent searches from localStorage
  renderRecentList();

  // Fetch trending immediately and then on a polling interval
  fetchTrending();
  setInterval(fetchTrending, TRENDING_POLL);

  // Focus search input
  searchInput.focus();

  console.log('%c🔍 Search Typeahead System', 'font-size:16px;font-weight:bold;color:#3b82f6');
  console.log('%cAPIs: /suggest  /search  /cache/debug  /metrics', 'color:#8b5cf6');
}

init();
