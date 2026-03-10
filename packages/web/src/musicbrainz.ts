const MUSICBRAINZ_BASE_URL = 'https://musicbrainz.org/ws/2';
const SPOTIFY_ARTIST_URL_PREFIX = 'https://open.spotify.com/artist/';

interface MusicBrainzUrlRelation {
  type: string;
  url: {
    resource: string;
  };
}

interface MusicBrainzArtistResponse {
  relations?: MusicBrainzUrlRelation[];
}

const spotifyUrlCache = new Map<string, string | null>();

/**
 * Fetch the Spotify artist URL for the given MusicBrainz artist MBID.
 * Returns the Spotify URL if found, or null if not available.
 */
export async function getSpotifyUrl(mbid: string): Promise<string | null> {
  if (spotifyUrlCache.has(mbid)) {
    return spotifyUrlCache.get(mbid) ?? null;
  }

  try {
    const url = `${MUSICBRAINZ_BASE_URL}/artist/${encodeURIComponent(mbid)}?inc=url-rels&fmt=json`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      spotifyUrlCache.set(mbid, null);
      return null;
    }

    const data = (await response.json()) as MusicBrainzArtistResponse;
    const spotifyRelation = data.relations?.find((relation) =>
      relation.url.resource.startsWith(SPOTIFY_ARTIST_URL_PREFIX),
    );
    const spotifyUrl = spotifyRelation?.url.resource ?? null;
    spotifyUrlCache.set(mbid, spotifyUrl);
    return spotifyUrl;
  } catch {
    spotifyUrlCache.set(mbid, null);
    return null;
  }
}

/**
 * Resolve the best play URL for the given artist: Spotify if available, Last.fm otherwise.
 * Opens the resolved URL in a new browser tab.
 */
export async function openPlayUrl(mbid: string, lastFmUrl: string): Promise<void> {
  const spotifyUrl = await getSpotifyUrl(mbid);
  window.open(spotifyUrl ?? lastFmUrl, '_blank', 'noopener,noreferrer');
}
