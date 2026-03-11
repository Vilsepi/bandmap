import {
  CACHE_TTL_MS,
  SEARCH_CACHE_TTL_MS,
  type Artist,
  type RelatedArtist,
  type SearchResult,
} from '@bandmap/shared';
import * as db from './db.js';
import { fetchArtistInfo, fetchSimilarArtists, searchArtists } from './lastfm/lastfm.js';

function isStale(fetchedAt: string, ttlMs: number = CACHE_TTL_MS): boolean {
  const fetchedTime = new Date(fetchedAt).getTime();
  return Date.now() - fetchedTime > ttlMs;
}

/**
 * Get an artist from the cache, or fetch from Last.fm if missing/stale.
 * Uses stampede protection: marks the entry as "refreshing" before fetching
 * so concurrent requests see a fresh-enough timestamp and skip the API call.
 */
export async function getOrFetchArtist(mbid: string): Promise<Artist> {
  const cached = await db.getArtist(mbid);

  if (cached && !isStale(cached.fetchedAt)) {
    return cached;
  }

  // Stampede protection: write a sentinel with updated fetchedAt
  // so other concurrent requests treat this entry as fresh.
  const sentinel: Artist | null = cached
    ? { ...cached, fetchedAt: new Date().toISOString() }
    : null;
  if (sentinel) {
    await db.putArtist(sentinel);
  }

  try {
    const apiKey = getLastFmApiKey();
    const artist = await fetchArtistInfo(mbid, apiKey);
    await db.putArtist(artist);
    return artist;
  } catch (err) {
    // Roll back sentinel on failure so the next request retries
    if (cached) {
      await db.putArtist(cached);
    }
    throw err;
  }
}

/**
 * Get related artists from the cache, or fetch from Last.fm if missing/stale.
 * Uses stampede protection similar to getOrFetchArtist.
 */
export async function getOrFetchRelatedArtists(mbid: string): Promise<RelatedArtist[]> {
  const cached = await db.getRelatedArtists(mbid);

  if (cached.length > 0 && !isStale(cached[0].fetchedAt)) {
    return cached;
  }

  // Stampede protection: update fetchedAt on existing entries
  if (cached.length > 0) {
    const now = new Date().toISOString();
    const sentinelItems = cached.map((r) => ({ ...r, fetchedAt: now }));
    await db.putRelatedArtists(mbid, sentinelItems);
  }

  try {
    const apiKey = getLastFmApiKey();
    const related = await fetchSimilarArtists(mbid, apiKey);
    await db.putRelatedArtists(mbid, related);
    return related;
  } catch (err) {
    // Roll back sentinel on failure
    if (cached.length > 0) {
      await db.putRelatedArtists(mbid, cached);
    }
    throw err;
  }
}

/**
 * Get search results from cache, or fetch from Last.fm if missing/stale.
 * Search results use a shorter TTL (1 day).
 */
export async function getOrFetchSearchResults(
  query: string,
  apiKey: string,
): Promise<SearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const cached = await db.getSearchResults(normalizedQuery);

  if (cached && !isStale(cached.fetchedAt, SEARCH_CACHE_TTL_MS)) {
    return cached.results;
  }

  const results = await searchArtists(normalizedQuery, apiKey);
  await db.putSearchResults(normalizedQuery, results);
  return results;
}

function getLastFmApiKey(): string {
  const key = process.env['LASTFM_API_KEY'];
  if (!key) {
    throw new Error('Missing environment variable: LASTFM_API_KEY');
  }
  return key;
}
