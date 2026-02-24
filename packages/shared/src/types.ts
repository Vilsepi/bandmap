/** A genre/style tag from Last.fm */
export interface Tag {
  /** PRIMARY KEY — deterministic hash of normalized name */
  id: string;
  /** Unique tag name, e.g. "post-metal" */
  name: string;
  /** last.fm tag page, e.g. "https://www.last.fm/tag/post-metal" */
  url: string;
}

/** Core artist record persisted from artist.getInfo */
export interface Artist {
  /** PRIMARY KEY — MusicBrainz ID */
  mbid: string;
  name: string;
  /** last.fm artist page */
  url: string;
  /** tag names, e.g. ["post-metal", "sludge"] — FK → Tag.name */
  tags: string[];
  /** ISO 8601 timestamp of last crawl */
  fetchedAt: string;
}

/**
 * Directed similarity edge from artist.getSimilar.
 * "source is similar to target with score match."
 * Note: Last.fm similarity is NOT symmetric — A→B may differ from B→A.
 */
export interface ArtistRelation {
  /** FK → Artist.mbid (the artist we queried) */
  sourceMbid: string;
  /** FK → Artist.mbid (a similar artist) */
  targetMbid: string;
  /** denormalized — target may not be crawled yet */
  targetName: string;
  /** denormalized — last.fm url of target */
  targetUrl: string;
  /** 0.0–1.0 similarity score. 1.0 is very similar. */
  match: number;
  /** ISO 8601 timestamp */
  fetchedAt: string;
}

/** Crawl queue entry */
export interface QueueEntry {
  mbid: string;
  name: string;
  /** BFS hops from seed */
  depth: number;
  status: 'pending' | 'done' | 'error';
  errorCount: number;
  lastError: string | null;
  addedAt: string;
  completedAt: string | null;
}

/** Export format for the web frontend */
export interface GraphExport {
  tags: {
    id: string;
    name: string;
    url: string;
  }[];
  artists: {
    id: string;
    name: string;
    url: string;
    tags: string[];
  }[];
  edges: {
    source: string;
    target: string;
    weight: number;
  }[];
}
