import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { SqliteStore } from './store/sqlite.js';
import type { Artist, ArtistRelation, Tag } from '@bandmap/shared';

const TEST_DB = '/tmp/bandmap-test.db';

function cleanupDb(): void {
  for (const ext of ['', '-wal', '-shm']) {
    const path = TEST_DB + ext;
    if (existsSync(path)) unlinkSync(path);
  }
}

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(() => {
    cleanupDb();
    store = new SqliteStore(TEST_DB);
  });

  afterEach(() => {
    store.close();
    cleanupDb();
  });

  describe('tags', () => {
    it('upserts and retrieves tags', () => {
      const tags: Tag[] = [
        { name: 'Post-Metal', url: 'https://www.last.fm/tag/Post-Metal' },
        { name: 'Sludge', url: 'https://www.last.fm/tag/Sludge' },
      ];
      store.upsertTags(tags);

      const result = store.getAllTags();
      assert.equal(result.length, 2);
      assert.equal(result[0].name, 'Post-Metal');
    });

    it('upserts tags idempotently', () => {
      const tag: Tag = { name: 'Rock', url: 'https://www.last.fm/tag/Rock' };
      store.upsertTags([tag]);
      store.upsertTags([{ name: 'Rock', url: 'https://www.last.fm/tag/Rock-updated' }]);

      const result = store.getAllTags();
      assert.equal(result.length, 1);
      assert.equal(result[0].url, 'https://www.last.fm/tag/Rock-updated');
    });
  });

  describe('artists', () => {
    it('upserts and retrieves an artist', () => {
      const tags: Tag[] = [{ name: 'Post-Metal', url: 'https://last.fm/tag/Post-Metal' }];
      store.upsertTags(tags);

      const artist: Artist = {
        mbid: 'test-mbid-1',
        name: 'Test Artist',
        url: 'https://last.fm/music/Test+Artist',
        tags: ['Post-Metal'],
        fetchedAt: '2025-01-01T00:00:00Z',
      };
      store.upsertArtist(artist);

      const result = store.getArtist('test-mbid-1');
      assert.ok(result);
      assert.equal(result.name, 'Test Artist');
      assert.deepEqual(result.tags, ['Post-Metal']);
    });

    it('hasArtist returns true for existing artist', () => {
      store.upsertTags([{ name: 'Rock', url: 'https://last.fm/tag/Rock' }]);
      store.upsertArtist({
        mbid: 'test-mbid-2',
        name: 'Another Artist',
        url: 'https://last.fm/music/Another',
        tags: ['Rock'],
        fetchedAt: '2025-01-01T00:00:00Z',
      });

      assert.equal(store.hasArtist('test-mbid-2'), true);
      assert.equal(store.hasArtist('nonexistent'), false);
    });

    it('getArtist returns null for missing artist', () => {
      assert.equal(store.getArtist('nonexistent'), null);
    });
  });

  describe('relations', () => {
    it('upserts and queries relations', () => {
      const relations: ArtistRelation[] = [
        {
          sourceMbid: 'a',
          targetMbid: 'b',
          targetName: 'B Artist',
          targetUrl: 'https://last.fm/music/B',
          match: 0.95,
          fetchedAt: '2025-01-01T00:00:00Z',
        },
        {
          sourceMbid: 'a',
          targetMbid: 'c',
          targetName: 'C Artist',
          targetUrl: 'https://last.fm/music/C',
          match: 0.7,
          fetchedAt: '2025-01-01T00:00:00Z',
        },
      ];
      store.upsertRelations(relations);

      const from = store.getRelationsFrom('a');
      assert.equal(from.length, 2);
      assert.equal(from[0].targetName, 'B Artist');

      const to = store.getRelationsTo('b');
      assert.equal(to.length, 1);
      assert.equal(to[0].sourceMbid, 'a');
    });
  });

  describe('crawl queue', () => {
    it('enqueues and dequeues by depth', () => {
      store.enqueue('mbid-1', 'Artist 1', 2);
      store.enqueue('mbid-2', 'Artist 2', 0);
      store.enqueue('mbid-3', 'Artist 3', 1);

      // Should dequeue lowest depth first
      const first = store.dequeue();
      assert.ok(first);
      assert.equal(first.mbid, 'mbid-2');
      assert.equal(first.depth, 0);
    });

    it('marks done and updates stats', () => {
      store.enqueue('mbid-1', 'Artist 1', 0);
      store.enqueue('mbid-2', 'Artist 2', 0);

      store.markDone('mbid-1');

      const stats = store.getQueueStats();
      assert.equal(stats.done, 1);
      assert.equal(stats.pending, 1);
    });

    it('marks error and updates stats', () => {
      store.enqueue('mbid-1', 'Artist 1', 0);
      store.markError('mbid-1', 'API failed');

      const stats = store.getQueueStats();
      assert.equal(stats.error, 1);
      assert.equal(stats.pending, 0);
    });

    it('isInQueue checks presence', () => {
      store.enqueue('mbid-1', 'Artist 1', 0);
      assert.equal(store.isInQueue('mbid-1'), true);
      assert.equal(store.isInQueue('nonexistent'), false);
    });

    it('dequeue returns null when empty', () => {
      assert.equal(store.dequeue(), null);
    });

    it('enqueue is idempotent (INSERT OR IGNORE)', () => {
      store.enqueue('mbid-1', 'Artist 1', 0);
      store.enqueue('mbid-1', 'Artist 1', 5); // same mbid, different depth

      const stats = store.getQueueStats();
      assert.equal(stats.pending, 1);

      const entry = store.dequeue();
      assert.ok(entry);
      assert.equal(entry.depth, 0); // original depth preserved
    });
  });

  describe('exportGraph', () => {
    it('exports artists and edges', () => {
      store.upsertTags([{ name: 'Metal', url: 'https://last.fm/tag/Metal' }]);
      store.upsertArtist({
        mbid: 'a',
        name: 'A',
        url: 'https://last.fm/music/A',
        tags: ['Metal'],
        fetchedAt: '2025-01-01T00:00:00Z',
      });
      store.upsertArtist({
        mbid: 'b',
        name: 'B',
        url: 'https://last.fm/music/B',
        tags: ['Metal'],
        fetchedAt: '2025-01-01T00:00:00Z',
      });
      store.upsertRelations([
        {
          sourceMbid: 'a',
          targetMbid: 'b',
          targetName: 'B',
          targetUrl: 'https://last.fm/music/B',
          match: 0.9,
          fetchedAt: '2025-01-01T00:00:00Z',
        },
      ]);

      const graph = store.exportGraph();
      assert.equal(graph.artists.length, 2);
      assert.equal(graph.edges.length, 1);
      assert.equal(graph.edges[0].weight, 0.9);
      assert.equal(graph.tags.length, 1);
    });

    it('excludes edges to non-crawled artists', () => {
      store.upsertTags([{ name: 'Metal', url: 'https://last.fm/tag/Metal' }]);
      store.upsertArtist({
        mbid: 'a',
        name: 'A',
        url: 'https://last.fm/music/A',
        tags: ['Metal'],
        fetchedAt: '2025-01-01T00:00:00Z',
      });
      // 'c' is not in the artists table
      store.upsertRelations([
        {
          sourceMbid: 'a',
          targetMbid: 'c',
          targetName: 'C',
          targetUrl: '',
          match: 0.5,
          fetchedAt: '2025-01-01T00:00:00Z',
        },
      ]);

      const graph = store.exportGraph();
      assert.equal(graph.edges.length, 0);
    });
  });
});
