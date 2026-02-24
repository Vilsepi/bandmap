# Bandmap

Crawls artists from [Last.fm](https://www.last.fm) and builds a graph of similar artists. Used to find new interesting artists you haven't listened to yet, based on similarity to music you like.

## Prerequisites

- Node.js ≥ 24
- A [Last.fm API key](https://www.last.fm/api/account/create)

## Install dependencies

```sh
npm install
```

## Build

```sh
npm run build
```

## Run tests

```sh
cd packages/crawler
npm test
```

## Crawl

Set the environment variable `LASTFM_API_KEY`.

Seed the crawler with one or more artist MBIDs (MusicBrainz IDs). Find MBIDs on [MusicBrainz](https://musicbrainz.org) or from Last.fm API responses.

```sh
# Single seed
node packages/crawler/dist/index.js crawl \
  --seed-mbid 79489e1b-5658-4e5f-8841-3e313946dc4d \
  --max-depth 3 --max-artists 500

# Multiple seeds
node packages/crawler/dist/index.js crawl \
  --seed-mbid 79489e1b-5658-4e5f-8841-3e313946dc4d \
  --seed-mbid c14b4180-dc87-481e-b17a-64e4150f90f6 \
  --max-depth 5 --max-artists 10000

# Seeds from file (one MBID per line)
node packages/crawler/dist/index.js crawl \
  --seed-file ./data/seeds.txt \
  --max-depth 5 --max-artists 10000

# Check progress
node packages/crawler/dist/index.js status
```

Data is stored in `./data/artists.db` (SQLite) by default. Use `--db <path>` to change.

The crawl is resumable — rerun the same command to continue where it left off.

## Export data for the frontend

```sh
node packages/crawler/dist/index.js export \
  --db ./data/artists.db \
  --out ./packages/web/public/graph.json
```

## Run the frontend

```sh
cd packages/web
npx vite
```

Then open http://localhost:5173 in your browser.

## Browsing the database

You can use e.g. `sqlite3` to view the data:

```sql
SELECT * from artists limit 10000;

-- Number of artists
SELECT COUNT(*) AS artist_count FROM artists;

-- Last fetched artists
SELECT * FROM artists ORDER BY fetched_at DESC LIMIT 3;

-- Latest additions to the crawl queue
SELECT * FROM crawl_queue ORDER BY added_at DESC LIMIT 3;

-- Find artists with duplicate names
SELECT mbid, name, COUNT(*) AS duplicate_count
FROM artists
GROUP BY name
HAVING COUNT(*) > 1;
```
