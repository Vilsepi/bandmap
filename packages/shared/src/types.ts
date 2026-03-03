/** A genre/style tag from Last.fm */
export interface Tag {
  /** PRIMARY KEY — deterministic hash of normalized name */
  id: string;
  /** Unique tag name, e.g. "post-metal" */
  name: string;
  /** last.fm tag page, e.g. "https://www.last.fm/tag/post-metal" */
  url: string;
}

/** A user of the bandmap application */
export interface User {
  /** PRIMARY KEY — API key for authentication */
  apiKey: string;
  /** Display name */
  name: string;
  /** ISO 8601 timestamp */
  createdAt: string;
}

/** Core artist record — pull-through cache of Last.fm artist.getInfo */
export interface Artist {
  /** PRIMARY KEY — MusicBrainz ID */
  mbid: string;
  name: string;
  /** last.fm artist page */
  url: string;
  /** tag names, e.g. ["post-metal", "sludge"] */
  tags: string[];
  /** ISO 8601 timestamp of last fetch from Last.fm */
  fetchedAt: string;
}

/**
 * A related-artist record — pull-through cache of artist.getSimilar.
 * "source is similar to target with score match."
 * Note: Last.fm similarity is NOT symmetric — A→B may differ from B→A.
 */
export interface RelatedArtist {
  /** PK — FK → Artist.mbid (the artist we queried) */
  sourceMbid: string;
  /** SK — FK → Artist.mbid (a similar artist) */
  targetMbid: string;
  /** denormalized — target may not be in the artists table yet */
  targetName: string;
  /** 0.0–1.0 similarity score. 1.0 is very similar. */
  match: number;
  /** ISO 8601 timestamp of last fetch */
  fetchedAt: string;
}

/** A user's rating on an artist — rated or bookmarked for later */
export interface Rating {
  /** PK — FK → User.apiKey */
  apiKey: string;
  /** SK — FK → Artist.mbid */
  artistMbid: string;
  /** 1–5 star rating (only set when status is "rated") */
  score: number | null;
  /** Status values: rated means user has scored it, or saved for later */
  status: 'rated' | 'todo';
  /** ISO 8601 timestamp */
  updatedAt: string;
}

/** A recommended artist for a user */
export interface Recommendation {
  /** PK — FK → User.apiKey */
  apiKey: string;
  /** SK — FK → Artist.mbid */
  artistMbid: string;
  /** denormalized artist name for display */
  artistName: string;
  /** computed relevance score (higher = more relevant) */
  score: number;
  /** the liked artist that led to this recommendation */
  sourceArtistMbid: string;
  /** denormalized source artist name */
  sourceArtistName: string;
  /** ISO 8601 timestamp */
  generatedAt: string;
}
