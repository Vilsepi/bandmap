import { normalizeTagName, tagId } from '@bandmap/shared';
import type { Tag, Artist, ArtistRelation } from '@bandmap/shared';

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

export class LastFmClient {
  private readonly baseUrl = 'https://ws.audioscrobbler.com/2.0/';

  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error('LASTFM_API_KEY is required');
    }
  }

  /**
   * Get artist info by mbid.
   * Returns parsed artist data with tags.
   */
  async getArtistInfo(mbid: string): Promise<ArtistInfoResult> {
    const params = new URLSearchParams({
      method: 'artist.getinfo',
      mbid,
      api_key: this.apiKey,
      format: 'json',
    });

    const data = (await this.request(params)) as LastFmArtistInfoResponse;

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
      artist: {
        mbid: artist.mbid,
        name: artist.name,
        url: artist.url,
        tags,
      },
    };
  }

  /**
   * Get similar artists by mbid.
   * Returns list of similar artists with match scores.
   */
  async getSimilarArtists(mbid: string, limit = 100): Promise<SimilarArtistEntry[]> {
    const params = new URLSearchParams({
      method: 'artist.getsimilar',
      mbid,
      api_key: this.apiKey,
      format: 'json',
      limit: String(limit),
    });

    const data = (await this.request(params)) as LastFmSimilarArtistsResponse;

    return (data.similarartists?.artist ?? []).map((a) => ({
      mbid: a.mbid ?? '',
      name: a.name,
      match: parseFloat(a.match),
      url: a.url,
    }));
  }

  private async request(params: URLSearchParams): Promise<unknown> {
    const url = `${this.baseUrl}?${params.toString()}`;
    const response = await fetch(url);

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
}
