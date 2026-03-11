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
