# 🔍 Search Typeahead System

> **HLD101 Assignment [SST-2028]** — A full-stack search typeahead system featuring distributed caching with consistent hashing, trending searches, and batch writes.

## ✨ Features

| Feature | Details |
|---|---|
| **Typeahead Suggestions** | Real-time suggestions as you type, debounced at 300ms |
| **Distributed Cache** | 4 cache nodes, consistent hashing ring, LRU + TTL eviction |
| **Consistent Hashing** | FNV-1a hash + binary search, 150 virtual nodes per physical node |
| **Trending Searches** | Recency-aware scoring: `0.4×count + 50×1h + 10×24h` |
| **Batch Writes** | In-memory buffer, flush every 5s or 100 entries; reduces DB writes significantly |
| **Premium UI** | Dark-mode glassmorphism, keyboard navigation, cache debug panel |

---

## 🚀 Quick Start

### Prerequisites
- Node.js v18+
- npm

### Setup
```bash
# 1. Install dependencies
npm install

# 2. Generate synthetic dataset (100K+ queries) + seed database
npm run setup

# 3. Start the development server
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## 📡 API Reference

### `GET /suggest?q=<prefix>`
Returns top 10 suggestions for a search prefix.

```bash
curl "http://localhost:3000/suggest?q=iph"
```

**Response:**
```json
{
  "query": "iph",
  "suggestions": [
    { "query": "iphone 16", "count": 42000, "trending_score": 16810 },
    { "query": "iphone price", "count": 31000, "trending_score": 12400 }
  ],
  "source": "cache",
  "latency_ms": 1
}
```

**Response Headers:**
- `X-Response-Time: 1ms`
- `X-Cache-Source: cache | db`

---

### `POST /search`
Submit a search query. Increments count + updates trending.

```bash
curl -X POST http://localhost:3000/search \
  -H "Content-Type: application/json" \
  -d '{"query": "iphone 16"}'
```

**Response:**
```json
{ "message": "Searched", "query": "iphone 16" }
```

---

### `GET /cache/debug?prefix=<prefix>`
Inspect the consistent hashing assignment and cache status for a prefix.

```bash
curl "http://localhost:3000/cache/debug?prefix=iph"
```

**Response:**
```json
{
  "prefix": "iph",
  "ring_position": 2847291034,
  "owning_node": "cache-node-2",
  "cache_hit": true,
  "cached_count": 10,
  "node_stats": { "nodeId": "cache-node-2", "size": 42, "hitRate": "87.3%", ... },
  "ring_distribution": { "cache-node-0": 150, "cache-node-1": 150, ... }
}
```

---

### `GET /metrics`
Full system metrics: latency percentiles, cache stats, batch writer stats, trending.

```bash
curl http://localhost:3000/metrics
```

---

### `GET /trending`
Top trending queries in the last hour.

```bash
curl http://localhost:3000/trending
```

---

## 🏗 Architecture

```
User types "iph"
     │
     ▼
[Frontend - debounced 300ms]
     │
     ▼  GET /suggest?q=iph
[Express API Layer]
     │
     ▼
[Consistent Hash Ring]
  hash("iph") = 2847291034
  → binary search → cache-node-2
     │
     ├─ CACHE HIT  → return suggestions (p50: ~1ms)
     │
     └─ CACHE MISS → SQLite: SELECT WHERE query LIKE 'iph%'
                           → enrich with trending scores
                           → store in cache-node-2
                           → return suggestions (p50: ~8ms)

User presses Enter
     │
     ▼  POST /search { query: "iphone 16" }
[BatchWriter buffer]
     │
     ├─ Aggregate count in-memory
     ├─ Record in TrendingService time bucket
     │
     └─ Every 5s: batch upsert → SQLite (single transaction)
```

---

## ⚙️ Consistent Hashing — How It Works

**Problem with naive modulo:** `hash(key) % N` — adding/removing a node remaps ~all keys.

**Solution — Consistent Hash Ring:**
1. Map each physical node to **150 virtual nodes** on a circular ring [0, 2³²)
2. For any key: `hash(key)` → binary search → first position clockwise → owning node
3. Adding a node only remaps `~1/N` of keys. With 4 nodes, ~25% remapping (vs 75% with modulo)

```
          0 ────────────────────────── 2³²
          │  node-0  node-2  node-1  node-3
          │   vvvv    vvvv    vvvv    vvvv
          ●────●──────●───────●────────●──●
                        ↑
                   hash("iph") maps here → node-2
```

---

## 📊 Trending Score Formula

```
trending_score = (all_time_count × 0.4) + (recent_1h × 50) + (recent_24h × 10)
```

| Component | Weight | Rationale |
|---|---|---|
| `all_time_count × 0.4` | Low | Prevents historically popular queries from being displaced by brief spikes |
| `recent_1h × 50` | Very High | Surfaces genuine viral/breaking trends immediately |
| `recent_24h × 10` | Medium | Rewards sustained daily interest without overweighting old data |

---

## ✍️ Batch Write — Trade-offs

| Approach | Write Volume | Latency | Data Loss Risk |
|---|---|---|---|
| Write-on-every-search | High (1 write/search) | Low | None |
| **Batch (this system)** | **Low (~5s aggregated)** | **Slightly higher** | **Buffer on crash** |
| WAL + batch | Low | Low | None |

**Our implementation:** buffer in-memory + flush every 5s. On process crash (SIGKILL), up to 5s of search counts may be lost. In production, a WAL (Write-Ahead Log) on disk would eliminate this risk.

---

## 🎨 Frontend Features

- **⌨️ Keyboard Navigation:** ↑↓ arrows to navigate, Enter to select/submit, Escape to close, Tab to inspect cache
- **🔍 Prefix Highlighting:** The typed portion is highlighted in blue within each suggestion
- **⚡ Cache Source Indicator:** Shows "Cache Hit" or "DB Query" with latency after each keystroke
- **🔥 Trending Panel:** Auto-refreshes every 30s
- **🕐 Recent Searches:** Stored in localStorage, clickable to re-search
- **⚙️ Cache Debug Panel:** Shows consistent hashing assignment, hit/miss, node stats
- **📊 Metrics Modal:** Full system metrics accessible from the nav bar

---

## 📁 Project Structure

```
Search-TypeAhead/
├── data/
│   ├── generate-dataset.js   # Synthetic 100K+ query generator
│   └── queries.csv           # Generated dataset
├── src/
│   ├── server.js             # Express entry point
│   ├── config.js             # Configuration
│   ├── db/
│   │   ├── init.js           # SQLite schema (WAL mode)
│   │   ├── queries.js        # DB query functions
│   │   └── seed.js           # CSV → SQLite seeder
│   ├── cache/
│   │   ├── consistent-hash.js  # Hash ring (FNV-1a + binary search)
│   │   ├── cache-node.js       # LRU + TTL cache node
│   │   └── cache-manager.js    # Distributed cache orchestrator
│   ├── services/
│   │   ├── suggestion-service.js  # Cache → DB fallback
│   │   ├── search-service.js      # Search submission handler
│   │   ├── trending-service.js    # Recency scoring
│   │   └── batch-writer.js        # Buffered DB writes
│   ├── routes/
│   │   ├── suggest.js         # GET /suggest
│   │   ├── search.js          # POST /search
│   │   └── cache-debug.js     # GET /cache/debug, /metrics
│   └── middleware/
│       └── logger.js          # Request logger + p95 tracking
└── public/
    ├── index.html             # Semantic HTML
    ├── styles.css             # Premium dark-mode CSS
    └── app.js                 # Frontend logic
```
