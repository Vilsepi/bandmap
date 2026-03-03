import type {
  SearchResponse,
  ArtistResponse,
  RelatedArtistsResponse,
  OpinionResponse,
  OpinionsListResponse,
  RecommendationsResponse,
  PutOpinionBody,
} from '@bandmap/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

function getApiKey(): string {
  return localStorage.getItem('bandmap-api-key') ?? '';
}

export function setApiKey(key: string): void {
  localStorage.setItem('bandmap-api-key', key);
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };

  const apiKey = getApiKey();
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API error ${response.status}: ${errorBody}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

// ── API functions ────────────────────────────────────────────

export async function searchArtists(query: string): Promise<SearchResponse> {
  return apiFetch<SearchResponse>(`/search?q=${encodeURIComponent(query)}`);
}

export async function getArtist(mbid: string): Promise<ArtistResponse> {
  return apiFetch<ArtistResponse>(`/artists/${mbid}`);
}

export async function getRelatedArtists(mbid: string): Promise<RelatedArtistsResponse> {
  return apiFetch<RelatedArtistsResponse>(`/artists/${mbid}/related`);
}

export async function listOpinions(status?: 'rated' | 'todo'): Promise<OpinionsListResponse> {
  const params = status ? `?status=${status}` : '';
  return apiFetch<OpinionsListResponse>(`/opinions${params}`);
}

export async function putOpinion(
  artistMbid: string,
  body: PutOpinionBody,
): Promise<OpinionResponse> {
  return apiFetch<OpinionResponse>(`/opinions/${artistMbid}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function deleteOpinion(artistMbid: string): Promise<void> {
  return apiFetch<void>(`/opinions/${artistMbid}`, { method: 'DELETE' });
}

export async function getRecommendations(): Promise<RecommendationsResponse> {
  return apiFetch<RecommendationsResponse>('/recommendations');
}

export async function generateRecommendations(): Promise<RecommendationsResponse> {
  return apiFetch<RecommendationsResponse>('/recommendations/generate', {
    method: 'POST',
  });
}
