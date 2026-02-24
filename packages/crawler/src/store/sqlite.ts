import Database from 'better-sqlite3';
import type { Tag, Artist, ArtistRelation, GraphExport } from '@bandmap/shared';
import type { CrawlStore, QueueStats } from './interface.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tags (
  name         TEXT PRIMARY KEY,
  url          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artists (
  mbid         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  fetched_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artist_tags (
  artist_mbid  TEXT NOT NULL REFERENCES artists(mbid),
  tag_name     TEXT NOT NULL REFERENCES tags(name),
  PRIMARY KEY (artist_mbid, tag_name)
);

CREATE INDEX IF NOT EXISTS idx_artist_tags_tag ON artist_tags(tag_name);

CREATE TABLE IF NOT EXISTS relations (
  source_mbid  TEXT NOT NULL,
  target_mbid  TEXT NOT NULL,
  target_name  TEXT NOT NULL,
  target_url   TEXT NOT NULL DEFAULT '',
  match        REAL NOT NULL,
  fetched_at   TEXT NOT NULL,
  PRIMARY KEY (source_mbid, target_mbid)
);

CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_mbid);

CREATE TABLE IF NOT EXISTS crawl_queue (
  mbid         TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending',
  depth        INTEGER NOT NULL DEFAULT 0,
  error_count  INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  added_at     TEXT NOT NULL,
  completed_at TEXT
);
`;

export class SqliteStore implements CrawlStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  // --- Tags ---

  upsertTags(tags: Tag[]): void {
    const stmt = this.db.prepare(
      'INSERT INTO tags (name, url) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET url = excluded.url',
    );
    const tx = this.db.transaction((items: Tag[]) => {
      for (const tag of items) {
        stmt.run(tag.name, tag.url);
      }
    });
    tx(tags);
  }

  getAllTags(): Tag[] {
    return this.db.prepare('SELECT name, url FROM tags').all() as Tag[];
  }

  // --- Artists ---

  upsertArtist(artist: Artist): void {
    const tx = this.db.transaction((a: Artist) => {
      this.db
        .prepare(
          `INSERT INTO artists (mbid, name, url, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(mbid) DO UPDATE SET
           name = excluded.name,
           url = excluded.url,
           fetched_at = excluded.fetched_at`,
        )
        .run(a.mbid, a.name, a.url, a.fetchedAt);

      // Replace tags: delete old, insert new
      this.db.prepare('DELETE FROM artist_tags WHERE artist_mbid = ?').run(a.mbid);

      const tagStmt = this.db.prepare(
        'INSERT OR IGNORE INTO artist_tags (artist_mbid, tag_name) VALUES (?, ?)',
      );
      for (const tagName of a.tags) {
        tagStmt.run(a.mbid, tagName);
      }
    });
    tx(artist);
  }

  getArtist(mbid: string): Artist | null {
    const row = this.db
      .prepare('SELECT mbid, name, url, fetched_at as fetchedAt FROM artists WHERE mbid = ?')
      .get(mbid) as { mbid: string; name: string; url: string; fetchedAt: string } | undefined;

    if (!row) return null;

    const tags = this.db
      .prepare('SELECT tag_name FROM artist_tags WHERE artist_mbid = ?')
      .all(mbid) as { tag_name: string }[];

    return {
      mbid: row.mbid,
      name: row.name,
      url: row.url,
      tags: tags.map((t) => t.tag_name),
      fetchedAt: row.fetchedAt,
    };
  }

  hasArtist(mbid: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM artists WHERE mbid = ?')
      .get(mbid) as Record<string, unknown> | undefined;
    return row !== undefined;
  }

  // --- Relations ---

  upsertRelations(relations: ArtistRelation[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO relations (source_mbid, target_mbid, target_name, target_url, match, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_mbid, target_mbid) DO UPDATE SET
         target_name = excluded.target_name,
         target_url = excluded.target_url,
         match = excluded.match,
         fetched_at = excluded.fetched_at`,
    );
    const tx = this.db.transaction((items: ArtistRelation[]) => {
      for (const r of items) {
        stmt.run(r.sourceMbid, r.targetMbid, r.targetName, r.targetUrl, r.match, r.fetchedAt);
      }
    });
    tx(relations);
  }

  getRelationsFrom(mbid: string): ArtistRelation[] {
    return this.db
      .prepare(
        `SELECT source_mbid as sourceMbid, target_mbid as targetMbid,
                target_name as targetName, target_url as targetUrl,
                match, fetched_at as fetchedAt
         FROM relations WHERE source_mbid = ?`,
      )
      .all(mbid) as ArtistRelation[];
  }

  getRelationsTo(mbid: string): ArtistRelation[] {
    return this.db
      .prepare(
        `SELECT source_mbid as sourceMbid, target_mbid as targetMbid,
                target_name as targetName, target_url as targetUrl,
                match, fetched_at as fetchedAt
         FROM relations WHERE target_mbid = ?`,
      )
      .all(mbid) as ArtistRelation[];
  }

  // --- Crawl Queue ---

  enqueue(mbid: string, name: string, depth: number): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO crawl_queue (mbid, name, depth, status, added_at)
         VALUES (?, ?, ?, 'pending', ?)`,
      )
      .run(mbid, name, depth, new Date().toISOString());
  }

  dequeue(): { mbid: string; name: string; depth: number } | null {
    const row = this.db
      .prepare(
        `SELECT mbid, name, depth FROM crawl_queue
         WHERE status = 'pending'
         ORDER BY depth ASC, rowid ASC
         LIMIT 1`,
      )
      .get() as { mbid: string; name: string; depth: number } | undefined;

    return row ?? null;
  }

  markDone(mbid: string): void {
    this.db
      .prepare(
        `UPDATE crawl_queue SET status = 'done', completed_at = ? WHERE mbid = ?`,
      )
      .run(new Date().toISOString(), mbid);
  }

  markError(mbid: string, error: string): void {
    this.db
      .prepare(
        `UPDATE crawl_queue
         SET status = 'error',
             error_count = error_count + 1,
             last_error = ?,
             completed_at = ?
         WHERE mbid = ?`,
      )
      .run(error, new Date().toISOString(), mbid);
  }

  getQueueStats(): QueueStats {
    const rows = this.db
      .prepare(
        `SELECT status, COUNT(*) as count FROM crawl_queue GROUP BY status`,
      )
      .all() as { status: string; count: number }[];

    const stats: QueueStats = { pending: 0, done: 0, error: 0 };
    for (const row of rows) {
      if (row.status === 'pending') stats.pending = row.count;
      else if (row.status === 'done') stats.done = row.count;
      else if (row.status === 'error') stats.error = row.count;
    }
    return stats;
  }

  isInQueue(mbid: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM crawl_queue WHERE mbid = ?')
      .get(mbid) as Record<string, unknown> | undefined;
    return row !== undefined;
  }

  // --- Export ---

  exportGraph(): GraphExport {
    const tags = this.getAllTags();

    const artistRows = this.db
      .prepare('SELECT mbid, name, url FROM artists')
      .all() as { mbid: string; name: string; url: string }[];

    const artists = artistRows.map((a) => {
      const artistTags = this.db
        .prepare('SELECT tag_name FROM artist_tags WHERE artist_mbid = ?')
        .all(a.mbid) as { tag_name: string }[];

      return {
        id: a.mbid,
        name: a.name,
        url: a.url,
        tags: artistTags.map((t) => t.tag_name),
      };
    });

    // Only include edges where both endpoints are crawled artists
    const edges = this.db
      .prepare(
        `SELECT r.source_mbid as source, r.target_mbid as target, r.match as weight
         FROM relations r
         INNER JOIN artists a1 ON r.source_mbid = a1.mbid
         INNER JOIN artists a2 ON r.target_mbid = a2.mbid`,
      )
      .all() as { source: string; target: string; weight: number }[];

    return { tags, artists, edges };
  }

  close(): void {
    this.db.close();
  }
}
