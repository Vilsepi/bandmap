import type { Artist, Rating, Recommendation, RelatedArtist } from './types.js';

// ── Request types ────────────────────────────────────────────

export interface SearchQuery {
  q: string;
}

export interface PutRatingBody {
  score: number | null;
  status: 'rated' | 'todo';
}

export interface ListRatingsQuery {
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

export interface RatingResponse {
  rating: Rating;
}

export interface RatingsListResponse {
  ratings: Rating[];
}

export interface RecommendationsResponse {
  recommendations: Recommendation[];
}

export interface ErrorResponse {
  error: string;
}
