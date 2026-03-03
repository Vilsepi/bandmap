import type { Artist, RelatedArtist } from '@bandmap/shared';
import { CACHE_TTL_MS } from '@bandmap/shared';
import * as db from './db.js';
import { fetchArtistInfo, fetchSimilarArtists } from './lastfm.js';

function isStale(fetchedAt: string): boolean {
  const fetchedTime = new Date(fetchedAt).getTime();
  return Date.now() - fetchedTime > CACHE_TTL_MS;
}

/**
 * Get an artist from the cache, or fetch from Last.fm if missing/stale.
 * Stores the result in DynamoDB before returning.
 */
export async function getOrFetchArtist(mbid: string): Promise<Artist> {
  const cached = await db.getArtist(mbid);

  if (cached && !isStale(cached.fetchedAt)) {
    return cached;
  }

  const apiKey = getLastFmApiKey();
  const artist = await fetchArtistInfo(mbid, apiKey);
  await db.putArtist(artist);
  return artist;
}

/**
 * Get related artists from the cache, or fetch from Last.fm if missing/stale.
 * Stores the result in DynamoDB before returning.
 */
export async function getOrFetchRelatedArtists(mbid: string): Promise<RelatedArtist[]> {
  const cached = await db.getRelatedArtists(mbid);

  if (cached.length > 0 && !isStale(cached[0].fetchedAt)) {
    return cached;
  }

  const apiKey = getLastFmApiKey();
  const related = await fetchSimilarArtists(mbid, apiKey);
  await db.putRelatedArtists(mbid, related);
  return related;
}

function getLastFmApiKey(): string {
  const key = process.env['LASTFM_API_KEY'];
  if (!key) {
    throw new Error('Missing environment variable: LASTFM_API_KEY');
  }
  return key;
}
