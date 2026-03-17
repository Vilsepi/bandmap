import type {
  AuthSessionResponse,
  SearchResponse,
  ArtistResponse,
  CreateInvitesRequest,
  CreateInvitesResponse,
  InviteLinkResponse,
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
  Rating,
} from '@bandmap/shared';

function readEnvVar(name: string): string | undefined {
  return (
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.[name] ??
    globalThis.process?.env?.[name]
  );
}

const API_BASE = (readEnvVar('VITE_API_BASE_URL') ?? '').replace(/\/+$/, '');
const CACHE_PREFIX = 'bandmap:v1';
const SESSION_STORAGE_KEY = 'bandmap-session';
const SESSION_PERSISTENCE_MS = 30 * 24 * 60 * 60 * 1000;
const ARTIST_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RATINGS_CACHE_TTL_MS = 60 * 1000;
const RECOMMENDATIONS_CACHE_TTL_MS = 60 * 1000;
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

function isStoredUser(user: unknown): user is StoredSession['user'] {
  const isAdmin = (user as { isAdmin?: unknown })?.isAdmin;
  return (
    typeof user === 'object' &&
    user !== null &&
    typeof (user as StoredSession['user']).id === 'string' &&
    typeof (user as StoredSession['user']).username === 'string' &&
    (typeof isAdmin === 'boolean' || isAdmin === undefined) &&
    typeof (user as StoredSession['user']).cognitoSub === 'string' &&
    typeof (user as StoredSession['user']).createdAt === 'number'
  );
}

function parseStoredSession(raw: string): StoredSession | null {
  const parsed = JSON.parse(raw) as Partial<StoredSession>;
  if (
    typeof parsed.sessionToken !== 'string' ||
    typeof parsed.refreshToken !== 'string' ||
    typeof parsed.expiresAt !== 'number' ||
    !isStoredUser(parsed.user)
  ) {
    return null;
  }

  return {
    sessionToken: parsed.sessionToken,
    refreshToken: parsed.refreshToken,
    expiresAt: parsed.expiresAt,
    user: {
      ...parsed.user,
      isAdmin: parsed.user.isAdmin ?? false,
    },
  };
}

function cookieSecureFlag(): string {
  return globalThis.isSecureContext === true ? '; Secure' : '';
}

function writeCookie(name: string, value: string, expiresAt: number): void {
  const expires = new Date(expiresAt).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Strict${cookieSecureFlag()}`;
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const cookie of document.cookie.split(';')) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

function deleteCookie(name: string): void {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Strict${cookieSecureFlag()}`;
}

function readStoredSessionRaw(): StoredSession | null {
  try {
    const raw = readCookie(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return parseStoredSession(raw);
  } catch {
    return null;
  }
}

function readStoredSession(): StoredSession | null {
  const raw = readCookie(SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const session = parseStoredSession(raw);
    if (!session) {
      deleteCookie(SESSION_STORAGE_KEY);
      return null;
    }

    return session;
  } catch {
    deleteCookie(SESSION_STORAGE_KEY);
    return null;
  }
}

function writeStoredSession(session: StoredSession): void {
  writeCookie(SESSION_STORAGE_KEY, JSON.stringify(session), Date.now() + SESSION_PERSISTENCE_MS);
}

function notifySessionUpdated(): void {
  if (typeof globalThis.dispatchEvent !== 'function') {
    return;
  }

  try {
    globalThis.dispatchEvent(new Event('bandmap:session-updated'));
  } catch {
    return;
  }
}

export function setSession(authSession: AuthSessionResponse): void {
  writeStoredSession({
    sessionToken: authSession.session.sessionToken,
    refreshToken: authSession.session.refreshToken,
    expiresAt: Date.now() + authSession.session.expiresIn * 1000,
    user: authSession.user,
  });
  notifySessionUpdated();
}

function clearCacheByPrefix(prefix: string): void {
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

export function clearSession(): void {
  const hadSessionCookie = readCookie(SESSION_STORAGE_KEY) !== null;
  const userId = readStoredSessionRaw()?.user.id;
  if (!hadSessionCookie && !userId) {
    return;
  }

  deleteCookie(SESSION_STORAGE_KEY);
  if (userId) {
    clearCacheByPrefix(`${CACHE_PREFIX}:user:${userId}:`);
  }
  notifySessionUpdated();
}

export function clearCachedData(): void {
  clearCacheByPrefix(`${CACHE_PREFIX}:`);
}

export function hasSession(): boolean {
  const session = readStoredSession();
  return !!session?.sessionToken;
}

export function getCurrentUser(): AuthSessionResponse['user'] | null {
  return readStoredSession()?.user ?? null;
}

export function isCurrentUserAdmin(): boolean {
  return getCurrentUser()?.isAdmin === true;
}

export function isApiConfigured(): boolean {
  return API_BASE.length > 0;
}

function createCacheKey(collection: 'artist' | 'related', artistId: string): string {
  return `${CACHE_PREFIX}:${collection}:${artistId}`;
}

function createUserCacheKey(
  collection: 'ratings' | 'recommendations',
  scope: string,
): string | null {
  const userId = readStoredSession()?.user.id;
  if (!userId) {
    return null;
  }

  return `${CACHE_PREFIX}:user:${userId}:${collection}:${scope}`;
}

function createRatingsCacheKey(status?: 'rated' | 'todo'): string | null {
  return createUserCacheKey('ratings', status ?? 'all');
}

function createRecommendationsCacheKey(): string | null {
  return createUserCacheKey('recommendations', 'all');
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

function updateCachedRecord<T>(
  key: string | null,
  ttlMs: number,
  updater: (current: T) => T,
): void {
  if (!key) {
    return;
  }

  const current = readCache<T>(key, ttlMs);
  if (!current) {
    return;
  }

  writeCache(key, updater(current));
}

function upsertRating(
  ratings: Rating[],
  nextRating: Rating,
  expectedStatus?: 'rated' | 'todo',
): Rating[] {
  const remainingRatings = ratings.filter((rating) => rating.artistId !== nextRating.artistId);
  if (expectedStatus === 'rated' && nextRating.score === null) {
    return remainingRatings;
  }
  if (expectedStatus === 'todo' && !nextRating.todo) {
    return remainingRatings;
  }
  if (!expectedStatus && nextRating.score === null && !nextRating.todo) {
    return remainingRatings;
  }
  return [...remainingRatings, nextRating];
}

function removeRating(ratings: Rating[], artistId: string): Rating[] {
  return ratings.filter((rating) => rating.artistId !== artistId);
}

function updateCachedRatings(nextRating: Rating): void {
  updateCachedRecord<RatingsListResponse>(
    createRatingsCacheKey(),
    RATINGS_CACHE_TTL_MS,
    ({ ratings }) => ({ ratings: upsertRating(ratings, nextRating) }),
  );
  updateCachedRecord<RatingsListResponse>(
    createRatingsCacheKey('rated'),
    RATINGS_CACHE_TTL_MS,
    ({ ratings }) => ({ ratings: upsertRating(ratings, nextRating, 'rated') }),
  );
  updateCachedRecord<RatingsListResponse>(
    createRatingsCacheKey('todo'),
    RATINGS_CACHE_TTL_MS,
    ({ ratings }) => ({ ratings: upsertRating(ratings, nextRating, 'todo') }),
  );
}

function removeCachedRating(artistId: string): void {
  updateCachedRecord<RatingsListResponse>(
    createRatingsCacheKey(),
    RATINGS_CACHE_TTL_MS,
    ({ ratings }) => ({ ratings: removeRating(ratings, artistId) }),
  );
  updateCachedRecord<RatingsListResponse>(
    createRatingsCacheKey('rated'),
    RATINGS_CACHE_TTL_MS,
    ({ ratings }) => ({ ratings: removeRating(ratings, artistId) }),
  );
  updateCachedRecord<RatingsListResponse>(
    createRatingsCacheKey('todo'),
    RATINGS_CACHE_TTL_MS,
    ({ ratings }) => ({ ratings: removeRating(ratings, artistId) }),
  );
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

function buildRequestHeaders(
  init: RequestInit | undefined,
  options: { includeSession?: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };

  const session = readStoredSession();
  if (options.includeSession !== false && session?.sessionToken) {
    headers['Authorization'] = `Bearer ${session.sessionToken}`;
  }

  return headers;
}

async function retryRequestAfterDelay(attempt: number): Promise<void> {
  await sleep(getRetryDelayMs(attempt));
}

function shouldRefreshSession(
  response: Response,
  options: { includeSession?: boolean; allowRefresh?: boolean },
): boolean {
  return (
    response.status === 401 &&
    options.allowRefresh !== false &&
    options.includeSession !== false &&
    !!readStoredSession()?.refreshToken
  );
}

async function createApiError(response: Response): Promise<Error> {
  const errorBody = await response.text();
  return new Error(`API error ${response.status}: ${errorBody}`);
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

  const headers = buildRequestHeaders(init, options);

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt += 1) {
    let response: Response;

    try {
      response = await executeApiRequest(path, headers, init);
    } catch (error) {
      if (attempt === MAX_API_RETRIES) {
        throw error;
      }
      await retryRequestAfterDelay(attempt);
      continue;
    }

    if (response.ok) {
      return parseApiResponse<T>(response);
    }

    if (shouldRefreshSession(response, options)) {
      await refreshSession();
      return sendRequest<T>(path, init, { ...options, allowRefresh: false });
    }

    lastError = await createApiError(response);
    if (attempt === MAX_API_RETRIES || !shouldRetryStatus(response.status)) {
      throw lastError;
    }

    await retryRequestAfterDelay(attempt);
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

export async function getLatestInviteLink(): Promise<InviteLinkResponse> {
  return apiFetch<InviteLinkResponse>('/invites/latest');
}

export async function searchArtists(query: string): Promise<SearchResponse> {
  return sendRequest<SearchResponse>(`/search?q=${encodeURIComponent(query)}`, undefined, {
    includeSession: true,
    allowRefresh: true,
  });
}

export async function getArtist(artistId: string): Promise<ArtistResponse> {
  const key = createCacheKey('artist', artistId);
  const cached = readCache<ArtistResponse>(key, ARTIST_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  const response = await apiFetch<ArtistResponse>(`/artists/${artistId}`);
  writeCache(key, response);
  return response;
}

export async function getRelatedArtists(artistId: string): Promise<RelatedArtistsResponse> {
  const key = createCacheKey('related', artistId);
  const cached = readCache<RelatedArtistsResponse>(key, ARTIST_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  const response = await apiFetch<RelatedArtistsResponse>(`/artists/${artistId}/related`);
  writeCache(key, response);
  return response;
}

export async function listRatings(status?: 'rated' | 'todo'): Promise<RatingsListResponse> {
  const key = createRatingsCacheKey(status);
  if (key) {
    const cached = readCache<RatingsListResponse>(key, RATINGS_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
  }

  const params = status ? `?status=${status}` : '';
  const response = await apiFetch<RatingsListResponse>(`/ratings${params}`);
  if (key) {
    writeCache(key, response);
  }
  return response;
}

export async function putRating(
  artistId: string,
  body: PutRatingBody,
): Promise<RatingResponse | undefined> {
  const response = await apiFetch<RatingResponse | undefined>(`/ratings/${artistId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (response?.rating) {
    updateCachedRatings(response.rating);
  } else {
    removeCachedRating(artistId);
  }
  return response;
}

export async function deleteRating(artistId: string): Promise<void> {
  await apiFetch<void>(`/ratings/${artistId}`, { method: 'DELETE' });
  removeCachedRating(artistId);
}

export async function getRecommendations(): Promise<RecommendationsResponse> {
  const key = createRecommendationsCacheKey();
  if (key) {
    const cached = readCache<RecommendationsResponse>(key, RECOMMENDATIONS_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
  }

  const response = await apiFetch<RecommendationsResponse>('/recommendations');
  if (key) {
    writeCache(key, response);
  }
  return response;
}

export async function generateRecommendations(): Promise<RecommendationsResponse> {
  const response = await apiFetch<RecommendationsResponse>('/recommendations/generate', {
    method: 'POST',
  });
  const key = createRecommendationsCacheKey();
  if (key) {
    writeCache(key, response);
  }
  return response;
}
