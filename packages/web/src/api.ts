import type {
  AuthSessionResponse,
  SearchResponse,
  ArtistResponse,
  CreateInvitesRequest,
  CreateInvitesResponse,
  RelatedArtistsResponse,
  RedeemInviteRequest,
  RedeemInviteResponse,
  RatingResponse,
  RatingsListResponse,
  RecommendationsResponse,
  LoginRequest,
  PutRatingBody,
  RefreshSessionRequest,
  ValidateInviteResponse,
} from '@bandmap/shared';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const CACHE_PREFIX = 'bandmap:v1';
const SESSION_STORAGE_KEY = 'bandmap-session';
const ARTIST_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const MAX_API_RETRIES = 3;

type StoredSession = {
  sessionToken: string;
  refreshToken: string;
  expiresAt: number;
  user: AuthSessionResponse['user'];
};

type CacheRecord<T> = {
  cachedAt: number;
  data: T;
};

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof parsed.sessionToken !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      typeof parsed.user !== 'object' ||
      parsed.user === null
    ) {
      clearSession();
      return null;
    }

    return parsed as StoredSession;
  } catch {
    clearSession();
    return null;
  }
}

function writeStoredSession(session: StoredSession): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function setSession(authSession: AuthSessionResponse): void {
  writeStoredSession({
    sessionToken: authSession.session.sessionToken,
    refreshToken: authSession.session.refreshToken,
    expiresAt: Date.now() + authSession.session.expiresIn * 1000,
    user: authSession.user,
  });
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function clearCachedData(): void {
  const prefix = `${CACHE_PREFIX}:`;
  const keysToRemove: string[] = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => {
    localStorage.removeItem(key);
  });
}

export function hasSession(): boolean {
  const session = readStoredSession();
  return !!session?.sessionToken;
}

export function getCurrentUser(): AuthSessionResponse['user'] | null {
  return readStoredSession()?.user ?? null;
}

export function isApiConfigured(): boolean {
  return API_BASE.length > 0;
}

function createCacheKey(collection: 'artist' | 'related', mbid: string): string {
  return `${CACHE_PREFIX}:${collection}:${mbid}`;
}

function readCache<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CacheRecord<T>;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.cachedAt !== 'number' ||
      !Number.isFinite(parsed.cachedAt)
    ) {
      localStorage.removeItem(key);
      return null;
    }

    if (Date.now() - parsed.cachedAt > ttlMs) {
      localStorage.removeItem(key);
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    const record: CacheRecord<T> = {
      cachedAt: Date.now(),
      data,
    };
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    return;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function getRetryDelayMs(attempt: number): number {
  const exponentialDelay = 200 * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 100);
  return exponentialDelay + jitter;
}

async function executeApiRequest(
  path: string,
  headers: Record<string, string>,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
}

function shouldRetryStatus(statusCode: number): boolean {
  return RETRYABLE_STATUS_CODES.has(statusCode);
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      `Expected JSON response but received: ${contentType || 'unknown content type'}`,
    );
  }

  return (await response.json()) as T;
}

async function sendRequest<T>(
  path: string,
  init: RequestInit | undefined,
  options: { includeSession?: boolean; allowRefresh?: boolean } = {},
): Promise<T> {
  if (!API_BASE) {
    throw new Error(
      'API base URL is not configured. Set the VITE_API_BASE_URL environment variable.',
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };

  const session = readStoredSession();
  if (options.includeSession !== false && session?.sessionToken) {
    headers['Authorization'] = `Bearer ${session.sessionToken}`;
  }

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt += 1) {
    let response: Response;

    try {
      response = await executeApiRequest(path, headers, init);
    } catch (error) {
      if (attempt === MAX_API_RETRIES) {
        throw error;
      }
      await sleep(getRetryDelayMs(attempt));
      continue;
    }

    if (!response.ok) {
      if (
        response.status === 401 &&
        options.allowRefresh !== false &&
        options.includeSession !== false &&
        session?.refreshToken
      ) {
        await refreshSession();
        return sendRequest<T>(path, init, { ...options, allowRefresh: false });
      }

      const errorBody = await response.text();
      lastError = new Error(`API error ${response.status}: ${errorBody}`);

      if (attempt === MAX_API_RETRIES || !shouldRetryStatus(response.status)) {
        throw lastError;
      }

      await sleep(getRetryDelayMs(attempt));
      continue;
    }

    return parseApiResponse<T>(response);
  }

  throw lastError ?? new Error('Request failed after retries');
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return sendRequest<T>(path, init, { includeSession: true, allowRefresh: true });
}

// ── API functions ────────────────────────────────────────────

export async function login(username: string, password: string): Promise<AuthSessionResponse> {
  const response = await sendRequest<AuthSessionResponse>(
    '/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ username, password } satisfies LoginRequest),
    },
    { includeSession: false, allowRefresh: false },
  );
  setSession(response);
  return response;
}

export async function refreshSession(): Promise<AuthSessionResponse> {
  const refreshToken = readStoredSession()?.refreshToken;
  if (!refreshToken) {
    throw new Error('Missing refresh token');
  }

  const response = await sendRequest<AuthSessionResponse>(
    '/auth/refresh',
    {
      method: 'POST',
      body: JSON.stringify({ refreshToken } satisfies RefreshSessionRequest),
    },
    { includeSession: false, allowRefresh: false },
  );
  setSession(response);
  return response;
}

export async function validateInvite(code: string): Promise<ValidateInviteResponse> {
  return sendRequest<ValidateInviteResponse>(
    `/invites/validate?code=${encodeURIComponent(code)}`,
    undefined,
    { includeSession: false, allowRefresh: false },
  );
}

export async function redeemInvite(request: RedeemInviteRequest): Promise<RedeemInviteResponse> {
  return sendRequest<RedeemInviteResponse>(
    '/invites/redeem',
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
    { includeSession: false, allowRefresh: false },
  );
}

export async function createInvites(request: CreateInvitesRequest): Promise<CreateInvitesResponse> {
  return apiFetch<CreateInvitesResponse>('/invites', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function searchArtists(query: string): Promise<SearchResponse> {
  return sendRequest<SearchResponse>(`/search?q=${encodeURIComponent(query)}`, undefined, {
    includeSession: true,
    allowRefresh: true,
  });
}

export async function getArtist(mbid: string): Promise<ArtistResponse> {
  const key = createCacheKey('artist', mbid);
  const cached = readCache<ArtistResponse>(key, ARTIST_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  const response = await apiFetch<ArtistResponse>(`/artists/${mbid}`);
  writeCache(key, response);
  return response;
}

export async function getRelatedArtists(mbid: string): Promise<RelatedArtistsResponse> {
  const key = createCacheKey('related', mbid);
  const cached = readCache<RelatedArtistsResponse>(key, ARTIST_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  const response = await apiFetch<RelatedArtistsResponse>(`/artists/${mbid}/related`);
  writeCache(key, response);
  return response;
}

export async function listRatings(status?: 'rated' | 'todo'): Promise<RatingsListResponse> {
  const params = status ? `?status=${status}` : '';
  return apiFetch<RatingsListResponse>(`/ratings${params}`);
}

export async function putRating(artistMbid: string, body: PutRatingBody): Promise<RatingResponse> {
  return apiFetch<RatingResponse>(`/ratings/${artistMbid}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function deleteRating(artistMbid: string): Promise<void> {
  return apiFetch<void>(`/ratings/${artistMbid}`, { method: 'DELETE' });
}

export async function getRecommendations(): Promise<RecommendationsResponse> {
  return apiFetch<RecommendationsResponse>('/recommendations');
}

export async function generateRecommendations(): Promise<RecommendationsResponse> {
  return apiFetch<RecommendationsResponse>('/recommendations/generate', {
    method: 'POST',
  });
}
