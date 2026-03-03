import type { Artist, Opinion, Recommendation, RelatedArtist } from './types.js';

// ── Request types ────────────────────────────────────────────

export interface SearchQuery {
  q: string;
}

export interface PutOpinionBody {
  score: number | null;
  status: 'rated' | 'todo';
}

export interface ListOpinionsQuery {
  status?: 'rated' | 'todo';
}

// ── Response types ───────────────────────────────────────────

export interface SearchResult {
  mbid: string;
  name: string;
  url: string;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface ArtistResponse {
  artist: Artist;
}

export interface RelatedArtistsResponse {
  sourceMbid: string;
  related: RelatedArtist[];
}

export interface OpinionResponse {
  opinion: Opinion;
}

export interface OpinionsListResponse {
  opinions: Opinion[];
}

export interface RecommendationsResponse {
  recommendations: Recommendation[];
}

export interface ErrorResponse {
  error: string;
}
