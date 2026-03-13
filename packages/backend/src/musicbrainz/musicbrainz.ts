import type { MusicBrainzLookupResponse, MusicBrainzSearchResponse } from './musicbrainzTypes.js';
import { logger } from '../log.js';

const MUSICBRAINZ_BASE_URL = 'https://musicbrainz.org/ws/2';
const SPOTIFY_URL_PREFIX = 'https://open.spotify.com/artist/';

/**
 * Minimum interval between MusicBrainz API requests (ms).
 * MusicBrainz enforces a rate limit of 1 request per second.
 */
const MIN_REQUEST_INTERVAL_MS = 1100;

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
  logger.debug(`Calling MusicBrainz API: ${url}`);
  return fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Bandmap/1.0 (https://music.heap.fi)',
    },
  });
}

/**
 * Search MusicBrainz for an artist by name.
 * Returns the MBID of the best match (score === 100) or null.
 */
export async function searchArtistMbid(artistName: string): Promise<string | null> {
  const query = encodeURIComponent(artistName);
  const url = `${MUSICBRAINZ_BASE_URL}/artist?query=artist:${query}&fmt=json&limit=5`;

  const response = await rateLimitedFetch(url);
  if (!response.ok) {
    logger.warn(
      { artistName, statusCode: response.status, statusText: response.statusText, url },
      'MusicBrainz artist search returned bad response',
    );
    return null;
  }

  const data = (await response.json()) as MusicBrainzSearchResponse;
  const exactMatch = data.artists.find((a) => a.score === 100);
  logger.debug(
    { artistName, mbid: exactMatch?.id ?? null },
    exactMatch ? 'Found MusicBrainz MBID match for artist' : 'No MusicBrainz MBID match for artist',
  );
  return exactMatch?.id ?? null;
}

/**
 * Look up an artist by MBID and extract the Spotify artist URL from url-rels.
 * Returns the Spotify URL or null if not found.
 */
export async function getSpotifyUrl(mbid: string): Promise<string | null> {
  const url = `${MUSICBRAINZ_BASE_URL}/artist/${encodeURIComponent(mbid)}?inc=url-rels&fmt=json`;

  const response = await rateLimitedFetch(url);
  if (!response.ok) {
    logger.warn(
      { mbid, statusCode: response.status, statusText: response.statusText, url },
      'MusicBrainz artist lookup returned bad response',
    );
    return null;
  }

  const data = (await response.json()) as MusicBrainzLookupResponse;
  const spotifyRelation = data.relations?.find((r) =>
    r.url.resource.startsWith(SPOTIFY_URL_PREFIX),
  );
  logger.debug(
    { mbid, spotifyUrl: spotifyRelation?.url.resource ?? null },
    spotifyRelation
      ? 'Found Spotify URL for MusicBrainz artist'
      : 'No Spotify URL found for MusicBrainz artist',
  );
  return spotifyRelation?.url.resource ?? null;
}
