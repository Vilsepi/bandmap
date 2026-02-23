# bandmap

Scrapes metal bands from [Metal Archives](https://www.metal-archives.com) and builds a graph of similar metal bands. Each band is a *node* and each "similar to" relationship is an *edge* in the graph.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Usage

All commands are run from the project root with `PYTHONPATH=src`:

### Crawl

Fetch recommendations starting from one or more seed band IDs (numeric ID in the URL of the band page) via breadth-first search:

```bash
PYTHONPATH=src .venv/bin/python -m bandmap crawl --seed 12613 --depth 2 --max-bands 500
PYTHONPATH=src .venv/bin/python -m bandmap crawl --seed 12613 6 151 --depth 2
```

Command-line arguments:

| Argument       | Default                  | Description                                     |
|----------------|--------------|-------------------------------------------------------------|
| `--seed`       | *(required)* | One or more band IDs to start from                          |
| `--depth`      | `2`          | Max BFS hops from any seed                                  |
| `--max-bands`  | `500`        | Stop after visiting this many bands                         |
| `--rate-limit` | `1.0`        | Min seconds between HTTP requests                           |
| `--output`     | `data`       | Output dir/path for JSON files (`bands.json`, `edges.json`) |
| `--sqlite`     | *(none)*     | Also save to this SQLite file                               |
| `--save-every` | `10`         | Save to disk every N bands (0 = only at end)                |
| `-v`           |              | Verbose logging                                             |

Crawls are **resumable** — re-running with the same `--output` continues where it left off.

JSON output is split across files in the output directory:

- `bands.json`: hashmap of `band_id -> band metadata` (`name`, `country`, `genre`, `url`)
- `edges.json`: list of `{source_id, target_id, score}` edges
- `crawl_state.json`: crawler checkpoint (`crawled_ids` + pending BFS queue)

You can find band IDs in Metal Archives URLs, e.g. `https://www.metal-archives.com/bands/Swallow_the_Sun/12613` → ID is `12613`.

### Export

Export the crawled graph to GEXF (Gephi), GraphML, and D3-compatible JSON:

```bash
PYTHONPATH=src .venv/bin/python -m bandmap export --input data --output-dir data/exports
```

Produces `bandgraph.gexf`, `bandgraph.graphml`, and `bandgraph_d3.json` in the output directory.

### Stats

Print graph statistics and most-connected bands:

```bash
PYTHONPATH=src .venv/bin/python -m bandmap stats --input data --top 20
```

## Project structure

```
src/bandmap/
├── __init__.py
├── __main__.py    # CLI entry point
├── models.py      # Pydantic data models (Band, SimilarEdge, BandGraph)
├── scraper.py     # HTTP fetching + HTML parsing
├── crawler.py     # BFS traversal logic
├── store.py       # JSON and SQLite persistence
└── graph.py       # NetworkX graph building, export, and analytics
```

## Data

Crawled data is saved to `data/` (gitignored). Raw HTML responses are cached in `data/cache/` to avoid redundant requests during development.

## Limitations

For now, this only includes metal bands which Metal Archives deems as *metal*.
