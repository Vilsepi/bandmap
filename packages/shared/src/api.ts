import type { Artist, Invite, Rating, Recommendation, RelatedArtist, User } from './types.js';

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

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RefreshSessionRequest {
  refreshToken: string;
}

export interface CreateInvitesRequest {
  count?: number;
}

export interface RedeemInviteRequest {
  code: string;
  username: string;
  password: string;
}

export interface ValidateInviteQuery {
  code: string;
}

// ── Response types ───────────────────────────────────────────

export interface SearchResult {
  aid: string;
  name: string;
  lastFmUrl: string;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface ArtistResponse {
  artist: Artist;
}

export interface RelatedArtistsResponse {
  sourceAid: string;
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

export interface AuthSession {
  sessionToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthSessionResponse {
  user: User;
  session: AuthSession;
}

export interface InviteSummary {
  code: string;
  inviteUrl: string;
  expiresAt: number;
  remainingUses: number;
}

export interface CreateInvitesResponse {
  invites: InviteSummary[];
}

export interface ValidateInviteResponse {
  invite: {
    code: string;
    expiresAt: number;
    remainingUses: number;
    isValid: boolean;
  };
}

export interface RedeemInviteResponse {
  user: User;
}

export interface InviteResponse {
  invite: Invite;
}

export interface ErrorResponse {
  error: string;
}
