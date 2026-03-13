/** MusicBrainz artist search response shape. */
export interface MusicBrainzSearchResponse {
  artists: MusicBrainzSearchArtist[];
  count: number;
  offset: number;
}

export interface MusicBrainzSearchArtist {
  id: string;
  name: string;
  score: number;
  'sort-name': string;
  'life-span'?: { ended: boolean | null };
  tags?: { count: number; name: string }[];
}

/** MusicBrainz artist lookup response (with url-rels). */
export interface MusicBrainzLookupResponse {
  id: string;
  name: string;
  relations?: MusicBrainzUrlRelation[];
}

export interface MusicBrainzUrlRelation {
  type: string;
  url: {
    resource: string;
  };
}
