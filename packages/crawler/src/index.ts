#!/usr/bin/env node

import { Command } from 'commander';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LastFmClient } from './client.js';
import { SqliteStore } from './store/sqlite.js';
import { crawl } from './crawl.js';

// Load .env from project root
config({ path: resolve(import.meta.dirname, '../../.env') });

const program = new Command();

program
  .name('bandmap-crawler')
  .description('Crawl the Last.fm artist similarity graph')
  .version('0.1.0');

program
  .command('crawl')
  .description('Crawl artists starting from seed MBIDs')
  .option('--seed-mbid <mbid...>', 'Seed artist MBID(s)')
  .option('--seed-file <path>', 'File with seed MBIDs (one per line)')
  .option('--max-depth <n>', 'Maximum BFS depth', '5')
  .option('--max-artists <n>', 'Maximum number of artists to crawl', '10000')
  .option('--db <path>', 'SQLite database path', './data/artists.db')
  .action(async (opts: {
    seedMbid?: string[];
    seedFile?: string;
    maxDepth: string;
    maxArtists: string;
    db: string;
  }) => {
    const apiKey = process.env['LASTFM_API_KEY'];
    if (!apiKey) {
      console.error('Error: LASTFM_API_KEY environment variable is required');
      console.error('Set it in .env or export it before running the crawler');
      process.exit(1);
    }

    // Collect seed MBIDs
    const seeds: { mbid: string; name: string }[] = [];

    if (opts.seedMbid) {
      for (const mbid of opts.seedMbid) {
        seeds.push({ mbid: mbid.trim(), name: '' });
      }
    }

    if (opts.seedFile) {
      const content = readFileSync(opts.seedFile, 'utf-8');
      for (const line of content.split('\n')) {
        // Strip inline comments (everything after #)
        const stripped = line.replace(/#.*$/, '').trim();
        if (stripped) {
          // Support "mbid name" or just "mbid" format
          const parts = stripped.split(/\s+/);
          seeds.push({ mbid: parts[0], name: parts.slice(1).join(' ') });
        }
      }
    }

    if (seeds.length === 0) {
      console.error('Error: provide at least one seed via --seed-mbid or --seed-file');
      process.exit(1);
    }

    // Ensure data directory exists
    const dbPath = resolve(opts.db);
    mkdirSync(dirname(dbPath), { recursive: true });

    const store = new SqliteStore(dbPath);
    const client = new LastFmClient(apiKey);

    // Enqueue seed artists
    for (const seed of seeds) {
      if (!store.isInQueue(seed.mbid) && !store.hasArtist(seed.mbid)) {
        store.enqueue(seed.mbid, seed.name, 0);
        console.log(`Enqueued seed: ${seed.name || seed.mbid}`);
      }
    }

    try {
      await crawl(client, store, {
        maxDepth: parseInt(opts.maxDepth, 10),
        maxArtists: parseInt(opts.maxArtists, 10),
      });
    } finally {
      store.close();
    }
  });

program
  .command('status')
  .description('Show crawl status')
  .option('--db <path>', 'SQLite database path', './data/artists.db')
  .action((opts: { db: string }) => {
    const store = new SqliteStore(resolve(opts.db));
    const stats = store.getQueueStats();
    console.log(`${stats.done} done, ${stats.pending} pending, ${stats.error} errors`);
    store.close();
  });

program
  .command('export')
  .description('Export graph data to JSON')
  .option('--db <path>', 'SQLite database path', './data/artists.db')
  .option('--out <path>', 'Output JSON file path', './data/graph.json')
  .action((opts: { db: string; out: string }) => {
    const store = new SqliteStore(resolve(opts.db));
    const graph = store.exportGraph();

    const outPath = resolve(opts.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(graph, null, 2));

    console.log(
      `Exported ${graph.artists.length} artists, ${graph.edges.length} edges, ${graph.tags.length} tags to ${outPath}`,
    );
    store.close();
  });

program.parse();
