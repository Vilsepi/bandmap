import { randomUUID } from 'node:crypto';
import {
  CACHE_TTL_MS,
  SEARCH_CACHE_TTL_MS,
  type Artist,
  type RelatedArtist,
  type SearchResult,
} from '@bandmap/shared';
import * as db from './db.js';
import { fetchArtistInfo, fetchSimilarArtists, searchArtists } from './lastfm/lastfm.js';
import { searchArtistMbid, getSpotifyUrl } from './musicbrainz/musicbrainz.js';

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

function isStale(fetchedAtEpoch: number, ttlMs: number = CACHE_TTL_MS): boolean {
  return Date.now() - fetchedAtEpoch * 1000 > ttlMs;
}

/**
 * Find or create an Artist record by Last.fm URL.
 * If the artist already exists in the DB and is fresh, returns it.
 * Otherwise creates a new record with a fresh UUIDv4 `artistId`.
 */
export async function getOrCreateArtist(
  lastFmUrl: string,
  name: string,
  mbid?: string,
): Promise<Artist> {
  const existing = await db.getArtistByLastFmUrl(lastFmUrl);
  if (existing && !isStale(existing.fetchedAt)) {
    return existing;
  }

  const artistId = existing?.artistId ?? randomUUID();
  const artist: Artist = {
    artistId,
    name,
    lastFmUrl,
    tags: existing?.tags,
    fetchedAt: nowEpoch(),
    mbid: mbid || existing?.mbid,
    spotifyUrl: existing?.spotifyUrl,
  };
  await db.putArtist(artist);
  return artist;
}

/**
 * Get an artist by artist ID from the cache, or re-fetch from Last.fm if stale.
 * Also lazily resolves MBID and Spotify URL via MusicBrainz when missing.
 */
export async function getOrFetchArtist(artistId: string): Promise<Artist> {
  const cached = await db.getArtist(artistId);
  if (!cached) {
    throw new Error(`Artist not found: ${artistId}`);
  }

  if (!isStale(cached.fetchedAt) && cached.tags !== undefined) {
    return enrichArtist(cached);
  }

  // Stampede protection
  const sentinel: Artist = { ...cached, fetchedAt: nowEpoch() };
  await db.putArtist(sentinel);

  try {
    const apiKey = getLastFmApiKey();
    const identifier = cached.mbid ? { mbid: cached.mbid } : { artistName: cached.name };
    const info = await fetchArtistInfo(identifier, apiKey);

    const artist: Artist = {
      ...cached,
      name: info.name,
      lastFmUrl: info.lastFmUrl,
      tags: info.tags.map((t) => t.name),
      fetchedAt: nowEpoch(),
      mbid: info.mbid || cached.mbid,
    };
    await db.putArtist(artist);
    return enrichArtist(artist);
  } catch (err) {
    await db.putArtist(cached);
    throw err;
  }
}

/**
 * Lazily resolve MBID (via MusicBrainz search) and Spotify URL (via MusicBrainz lookup)
 * when they are missing from the artist record. Writes back to DB on enrichment.
 */
async function enrichArtist(artist: Artist): Promise<Artist> {
  let updated = false;

  if (!artist.mbid) {
    try {
      const mbid = await searchArtistMbid(artist.name);
      if (mbid) {
        artist = { ...artist, mbid };
        updated = true;
      }
    } catch {
      // MusicBrainz unavailable — skip enrichment
    }
  }

  if (artist.mbid && !artist.spotifyUrl) {
    try {
      const spotifyUrl = await getSpotifyUrl(artist.mbid);
      if (spotifyUrl) {
        artist = { ...artist, spotifyUrl };
        updated = true;
      }
    } catch {
      // MusicBrainz unavailable — skip enrichment
    }
  }

  if (updated) {
    await db.putArtist(artist);
  }
  return artist;
}

/**
 * Get related artists from the cache, or fetch from Last.fm if missing/stale.
 * Each related artist is resolved via getOrCreateArtist to ensure they have artist IDs.
 */
export async function getOrFetchRelatedArtists(artistId: string): Promise<RelatedArtist[]> {
  const cached = await db.getRelatedArtists(artistId);

  if (cached.length > 0 && !isStale(cached[0].fetchedAt)) {
    return cached;
  }

  // Stampede protection
  if (cached.length > 0) {
    const now = nowEpoch();
    const sentinelItems = cached.map((r) => ({ ...r, fetchedAt: now }));
    await db.putRelatedArtists(artistId, sentinelItems);
  }

  try {
    const source = await db.getArtist(artistId);
    if (!source) throw new Error(`Artist not found: ${artistId}`);

    const apiKey = getLastFmApiKey();
    const identifier = source.mbid ? { mbid: source.mbid } : { artistName: source.name };
    const entries = await fetchSimilarArtists(identifier, apiKey);

    const now = nowEpoch();
    const related: RelatedArtist[] = [];
    for (const entry of entries) {
      const target = await getOrCreateArtist(entry.lastFmUrl, entry.name, entry.mbid);
      related.push({
        sourceId: artistId,
        targetId: target.artistId,
        targetName: target.name,
        targetLastFmUrl: target.lastFmUrl,
        match: entry.match,
        fetchedAt: now,
      });
    }

    await db.putRelatedArtists(artistId, related);
    return related;
  } catch (err) {
    if (cached.length > 0) {
      await db.putRelatedArtists(artistId, cached);
    }
    throw err;
  }
}

/**
 * Get search results from cache, or fetch from Last.fm if missing/stale.
 * Each result is resolved via getOrCreateArtist to ensure they have artist IDs.
 */
export async function getOrFetchSearchResults(query: string): Promise<SearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const cached = await db.getSearchResults(normalizedQuery);

  if (cached && !isStale(cached.fetchedAt, SEARCH_CACHE_TTL_MS)) {
    return cached.results;
  }

  const apiKey = getLastFmApiKey();
  const lastFmResults = await searchArtists(normalizedQuery, apiKey);

  const results: SearchResult[] = [];
  for (const entry of lastFmResults) {
    const artist = await getOrCreateArtist(entry.lastFmUrl, entry.name, entry.mbid);
    results.push({ artistId: artist.artistId, name: artist.name, lastFmUrl: artist.lastFmUrl });
  }

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
