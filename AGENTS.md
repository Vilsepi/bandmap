# AGENTS.md

Instructions for AI coding agents working on this project.

## Key design decisions

### Cloudflare bypass with curl_cffi

Metal Archives is behind Cloudflare with TLS fingerprinting. Standard HTTP libraries (`httpx`, `requests`, `urllib`) get 403'd even with browser-like headers. The scraper uses `curl_cffi` with `impersonate="chrome"` to match a real browser's TLS fingerprint. **Do not replace `curl_cffi` with `httpx` or `requests`** — it will break.

### Async but sequential

The crawler is async but uses `concurrency=1` by default (one request at a time) with a 1-second rate limit. This is deliberate — Metal Archives is a community site and we must be polite. Do not increase concurrency without good reason.

### BFS crawl with incremental saves

The crawler saves JSON incrementally after every band visited (`bands.json`, `edges.json`, and `crawl_state.json`). If interrupted, re-running with the same output path resumes from `crawl_state.json`, which stores both crawled IDs and the pending BFS queue.

### Pydantic models as source of truth

`BandGraph` (in `models.py`) is the canonical data structure. Both `JsonStore` and `SqliteStore` serialize/deserialize from it. Any new fields must be added to the Pydantic models first.

### Seed bands are stub nodes

When crawling from a seed ID, the seed band's own metadata (name, country, genres) is **not** available from the recommendations endpoint — only its similar bands are returned. The seed appears in the graph as a node with just its ID. At depth ≥ 1, other bands' recommendations may include the seed, filling in its metadata. This is expected behaviour, not a bug.

## Project layout

```
src/bandmap/
├── models.py      # Band, SimilarEdge, BandGraph — all Pydantic
├── scraper.py     # Scraper class: fetch (curl_cffi) + parse (BeautifulSoup)
├── crawler.py     # Crawler class: BFS queue, visited set, incremental save
├── store.py       # JsonStore, SqliteStore — persistence backends
├── graph.py       # NetworkX graph building, GEXF/GraphML/D3 export, stats
└── __main__.py    # CLI: crawl, export, stats subcommands

web/
├── index.html     # Single-page app shell
├── style.css      # Dark-themed styles
└── app.js         # D3.js force-directed ego-graph explorer
```

## How to run

```bash
# Setup
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# All commands need PYTHONPATH=src
export PYTHONPATH=src

# Quick test crawl (depth 0 = seed's recommendations only, fast)
.venv/bin/python -m bandmap crawl --seed 12613 --depth 0 --max-bands 5

# Verify output
cat data/bands.json | python3 -m json.tool | head -30

# Test export
.venv/bin/python -m bandmap export

# Test stats
.venv/bin/python -m bandmap stats --top 10

# Web frontend (serve from project root)
python3 -m http.server 8000
# Then open http://localhost:8000/web/
```

## How to test

There are no automated tests yet. To verify changes work:

1. **Parser unit test** — feed cached HTML to `Scraper.parse_recommendations()`:
   ```python
   from bandmap.scraper import Scraper
   html = open("data/cache/<some_cached_file>.html").read()
   results = Scraper.parse_recommendations(html, source_band_id=12613)
   assert len(results) > 0
   assert results[0][0].name  # Band has a name
   assert results[0][1].source_id == 12613  # Edge points back to source
   ```

2. **End-to-end crawl** — run a depth-0 crawl and check the JSON:
   ```bash
   rm -f data/bands.json data/edges.json
   PYTHONPATH=src .venv/bin/python -m bandmap crawl --seed 12613 --depth 0
   # Should print "Done — 20 bands, 20 edges" (count may vary)
   ```

3. **Export** — verify all three formats are generated without errors:
   ```bash
   PYTHONPATH=src .venv/bin/python -m bandmap export
   ls data/bandgraph.{gexf,graphml} data/bandgraph_d3.json
   ```

4. **Resume test** — run a crawl, interrupt it, run again, verify it continues:
   ```bash
   PYTHONPATH=src .venv/bin/python -m bandmap crawl --seed 12613 --depth 1 --max-bands 3
   PYTHONPATH=src .venv/bin/python -m bandmap crawl --seed 12613 --depth 1 --max-bands 10
   # Second run should skip already-visited bands
   ```

## Common pitfalls

- **403 errors**: means Cloudflare is blocking. Only `curl_cffi` with browser impersonation works. Never downgrade to plain `httpx`/`requests`.
- **Empty results**: the `artist_list` table might not exist for bands with no recommendations. The parser returns `[]` — this is handled gracefully.
- **NetworkX API changes**: `node_link_data()` returns `"edges"` not `"links"` in networkx ≥ 3.x. We already handle this.
- **Rate limiting**: if you see 429s, increase `--rate-limit`. Default 1.0s is usually fine.
