import {
  normalizeTagName,
  tagId,
  LASTFM_MAX_CONCURRENT,
  LASTFM_MAX_RETRIES,
  LASTFM_RETRY_BASE_MS,
} from '@bandmap/shared';
import type { Tag } from '@bandmap/shared';
import type {
  LastFmArtistInfoResponse,
  LastFmArtistSearchResponse,
  LastFmSimilarArtistsResponse,
} from './lastfmTypes.js';

/** Parsed artist info result from Last.fm */
export interface LastFmArtistInfo {
  name: string;
  lastFmUrl: string;
  mbid?: string;
  tags: Tag[];
}

/** Parsed similar artist entry from Last.fm */
export interface LastFmSimilarArtistEntry {
  name: string;
  lastFmUrl: string;
  mbid?: string;
  match: number;
}

/** Parsed search result from Last.fm */
export interface LastFmSearchResult {
  name: string;
  lastFmUrl: string;
  mbid?: string;
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
 * Fetch artist info from Last.fm.
 * Accepts either an MBID or an artist name (at least one must be provided).
 * Returns raw parsed data — internal ID assignment happens in the cache layer.
 */
export async function fetchArtistInfo(
  identifier: { mbid: string } | { artistName: string },
  apiKey: string,
): Promise<LastFmArtistInfo> {
  const params = new URLSearchParams({
    method: 'artist.getinfo',
    api_key: apiKey,
    format: 'json',
  });

  if ('mbid' in identifier) {
    params.set('mbid', identifier.mbid);
  } else {
    params.set('artist', identifier.artistName);
  }

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

  const mbid = artist.mbid && artist.mbid.length > 0 ? artist.mbid : undefined;

  return {
    name: artist.name,
    lastFmUrl: artist.url,
    mbid,
    tags,
  };
}

/**
 * Fetch similar artists from Last.fm.
 * Accepts either an MBID or an artist name.
 * Returns raw entries — no filtering by MBID presence, no internal ID assignment.
 */
export async function fetchSimilarArtists(
  identifier: { mbid: string } | { artistName: string },
  apiKey: string,
  limit = 100,
): Promise<LastFmSimilarArtistEntry[]> {
  const params = new URLSearchParams({
    method: 'artist.getsimilar',
    api_key: apiKey,
    format: 'json',
    limit: String(limit),
  });

  if ('mbid' in identifier) {
    params.set('mbid', identifier.mbid);
  } else {
    params.set('artist', identifier.artistName);
  }

  const data = (await lastfmRequest(params)) as LastFmSimilarArtistsResponse;

  return (data.similarartists?.artist ?? []).map((a) => ({
    name: a.name,
    lastFmUrl: a.url,
    mbid: a.mbid && a.mbid.length > 0 ? a.mbid : undefined,
    match: Number.parseFloat(a.match),
  }));
}

/**
 * Search for artists by name on Last.fm.
 * Returns all results including those without MBIDs.
 */
export async function searchArtists(
  query: string,
  apiKey: string,
  limit = 5,
): Promise<LastFmSearchResult[]> {
  const params = new URLSearchParams({
    method: 'artist.search',
    artist: query,
    api_key: apiKey,
    format: 'json',
    limit: String(limit),
  });

  const data = (await lastfmRequest(params)) as LastFmArtistSearchResponse;

  return (data.results?.artistmatches?.artist ?? []).map((a) => ({
    name: a.name,
    lastFmUrl: a.url,
    mbid: a.mbid && a.mbid.length > 0 ? a.mbid : undefined,
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
