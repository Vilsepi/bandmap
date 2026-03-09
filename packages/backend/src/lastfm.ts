import {
  normalizeTagName,
  tagId,
  LASTFM_MAX_CONCURRENT,
  LASTFM_MAX_RETRIES,
  LASTFM_RETRY_BASE_MS,
} from '@bandmap/shared';
import type { Tag, Artist, RelatedArtist } from '@bandmap/shared';

/** Raw Last.fm API response types (only the fields we use) */

/** artist.getInfo response */
export interface LastFmArtistInfoResponse {
  artist: {
    name: string;
    mbid: string;
    url: string;
    tags: {
      tag: {
        name: string;
        url: string;
      }[];
    };
  };
}

/** artist.getSimilar response */
export interface LastFmSimilarArtistsResponse {
  similarartists: {
    artist: {
      name: string;
      mbid: string;
      match: string;
      url: string;
    }[];
  };
}

/** artist.search response */
export interface LastFmArtistSearchResponse {
  results: {
    artistmatches: {
      artist: {
        name: string;
        mbid: string;
        url: string;
      }[];
    };
  };
}

/** Parsed artist info result */
export interface ArtistInfoResult {
  artist: {
    mbid: string;
    name: string;
    url: string;
    tags: Tag[];
  };
}

/** Parsed similar artist entry */
export interface SimilarArtistEntry {
  mbid: string;
  name: string;
  match: number;
  url: string;
}

function sortRelatedArtistsByMatch(items: RelatedArtist[]): RelatedArtist[] {
  return items.sort((a, b) => {
    if (b.match !== a.match) {
      return b.match - a.match;
    }

    const nameOrder = a.targetName.localeCompare(b.targetName);
    if (nameOrder !== 0) {
      return nameOrder;
    }

    return a.targetMbid.localeCompare(b.targetMbid);
  });
}

export class LastFmApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LastFmApiError';
  }
}

const LASTFM_BASE_URL = 'https://ws.audioscrobbler.com/2.0/';
const LASTFM_USER_AGENT = 'bandmap';

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test';
}

/**
 * Fetch artist info by mbid from Last.fm.
 * Returns parsed artist data with tags.
 */
export async function fetchArtistInfo(mbid: string, apiKey: string): Promise<Artist> {
  const params = new URLSearchParams({
    method: 'artist.getinfo',
    mbid,
    api_key: apiKey,
    format: 'json',
  });

  const data = (await lastfmRequest(params)) as LastFmArtistInfoResponse;

  const artist = data.artist;
  const tags: Tag[] = (artist.tags?.tag ?? []).map((t) => {
    const name = normalizeTagName(t.name);
    return {
      id: tagId(name),
      name,
      url: t.url.toLowerCase(),
    };
  });

  return {
    mbid: artist.mbid,
    name: artist.name,
    url: artist.url,
    tags: tags.map((t) => t.name),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetch similar artists by mbid from Last.fm.
 * Returns list of related artist records.
 */
export async function fetchSimilarArtists(
  mbid: string,
  apiKey: string,
  limit = 100,
): Promise<RelatedArtist[]> {
  const params = new URLSearchParams({
    method: 'artist.getsimilar',
    mbid,
    api_key: apiKey,
    format: 'json',
    limit: String(limit),
  });

  const data = (await lastfmRequest(params)) as LastFmSimilarArtistsResponse;
  const now = new Date().toISOString();

  return sortRelatedArtistsByMatch(
    (data.similarartists?.artist ?? [])
      .filter((a) => a.mbid && a.mbid.length > 0)
      .map((a) => ({
        sourceMbid: mbid,
        targetMbid: a.mbid,
        targetName: a.name,
        match: Number.parseFloat(a.match),
        fetchedAt: now,
      })),
  );
}

/**
 * Search for artists by name on Last.fm.
 */
export async function searchArtists(
  query: string,
  apiKey: string,
  limit = 10,
): Promise<{ mbid: string; name: string; url: string }[]> {
  const params = new URLSearchParams({
    method: 'artist.search',
    artist: query,
    api_key: apiKey,
    format: 'json',
    limit: String(limit),
  });

  const data = (await lastfmRequest(params)) as LastFmArtistSearchResponse;

  return (data.results?.artistmatches?.artist ?? [])
    .filter((a) => a.mbid && a.mbid.length > 0)
    .map((a) => ({
      mbid: a.mbid,
      name: a.name,
      url: a.url,
    }));
}

// ── Semaphore for limiting concurrent Last.fm requests ────────

/**
 * Simple promise-based semaphore to limit concurrent outgoing requests.
 * Module-level state: works within a single invocation and across warm reuse.
 */
class Semaphore {
  private running = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.running--;
    }
  }
}

const semaphore = new Semaphore(LASTFM_MAX_CONCURRENT);

/** Exported for testing only */
export { Semaphore };

// ── Core request with retry + semaphore ───────────────────────

async function lastfmRequest(params: URLSearchParams): Promise<unknown> {
  await semaphore.acquire();
  try {
    return await lastfmRequestWithRetry(params);
  } finally {
    semaphore.release();
  }
}

async function lastfmRequestWithRetry(params: URLSearchParams): Promise<unknown> {
  let lastError: LastFmApiError | undefined;

  for (let attempt = 0; attempt <= LASTFM_MAX_RETRIES; attempt++) {
    try {
      return await lastfmFetch(params);
    } catch (err) {
      if (err instanceof LastFmApiError && err.retryable && attempt < LASTFM_MAX_RETRIES) {
        lastError = err;
        const delay = LASTFM_RETRY_BASE_MS * Math.pow(4, attempt);
        if (!isTestRuntime()) {
          console.warn('Retrying Last.fm API request after retryable error', {
            statusCode: err.statusCode,
            attempt: attempt + 1,
            maxRetries: LASTFM_MAX_RETRIES,
            delayMs: delay,
            params: params.toString(),
          });
        }
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lastfmFetch(params: URLSearchParams): Promise<unknown> {
  const url = `${LASTFM_BASE_URL}?${params.toString()}`;
  if (!isTestRuntime()) {
    console.log(`Calling Last.fm API: ${url}`);
  }
  const response = await fetch(url, {
    headers: {
      'User-Agent': LASTFM_USER_AGENT,
    },
  });

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new LastFmApiError(
      `Last.fm API error: ${response.status} ${response.statusText}`,
      response.status,
      retryable,
    );
  }

  const json: unknown = await response.json();

  // Last.fm sometimes returns errors inside a 200 response
  if (typeof json === 'object' && json !== null && 'error' in json) {
    const errObj = json as { error: number; message: string };
    throw new LastFmApiError(
      `Last.fm API error ${errObj.error}: ${errObj.message}`,
      errObj.error,
      false,
    );
  }

  return json;
}
