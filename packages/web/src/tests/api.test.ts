import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type {
  AuthSessionResponse,
  Rating,
  RatingsListResponse,
  RecommendationsResponse,
} from '@bandmap/shared';

class LocalStorageMock implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

class CookieJarMock {
  private readonly cookies = new Map<string, { value: string; expiresAt?: number }>();

  private sweepExpiredCookies(): void {
    for (const [name, cookie] of this.cookies.entries()) {
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= Date.now()) {
        this.cookies.delete(name);
      }
    }
  }

  get cookie(): string {
    this.sweepExpiredCookies();
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v.value}`).join('; ');
  }

  set cookie(assignment: string) {
    const parts = assignment.split(';').map((p) => p.trim());
    const nameValue = parts[0] ?? '';
    const eqIdx = nameValue.indexOf('=');
    if (eqIdx === -1) return;
    const name = nameValue.slice(0, eqIdx);
    const value = nameValue.slice(eqIdx + 1);

    const expiresPart = parts.find((p) => p.toLowerCase().startsWith('expires='));
    const expiresAt = expiresPart
      ? new Date(expiresPart.slice(expiresPart.indexOf('=') + 1)).getTime()
      : undefined;
    if (expiresPart) {
      if ((expiresAt ?? 0) <= Date.now()) {
        this.cookies.delete(name);
        return;
      }
    }

    this.cookies.set(name, { value, expiresAt });
  }

  clear(): void {
    this.cookies.clear();
  }
}

const localStorage = new LocalStorageMock();
const cookieJar = new CookieJarMock();
const originalDispatchEvent = globalThis.dispatchEvent;

const session: AuthSessionResponse = {
  user: {
    id: 'user-1',
    username: 'tester',
    isAdmin: true,
    cognitoSub: 'cognito-sub-1',
    createdAt: 1735689600,
  },
  session: {
    sessionToken: 'session-token',
    refreshToken: 'refresh-token',
    expiresIn: 3600,
  },
};

const ratedArtist: Rating = {
  userId: 'user-1',
  artistId: 'artist-rated',
  score: 5,
  status: 'rated',
  updatedAt: 1735689600,
};

const todoArtist: Rating = {
  userId: 'user-1',
  artistId: 'artist-todo',
  score: null,
  status: 'todo',
  updatedAt: 1735776000,
};

const olderRatedArtist: Rating = {
  userId: 'user-1',
  artistId: 'artist-old-rated',
  score: 3,
  status: 'rated',
  updatedAt: 1735603200,
};

const recommendations: RecommendationsResponse = {
  recommendations: [
    {
      userId: 'user-1',
      artistId: 'artist-rec-1',
      artistName: 'Recommended Artist',
      score: 0.91,
      sourceId: 'artist-rated',
      sourceName: 'Rated Artist',
      generatedAt: 1735862400,
    },
  ],
};

Object.assign(globalThis, { localStorage, document: cookieJar });

async function importApiModule() {
  return import('../api.js');
}

let api: Awaited<ReturnType<typeof importApiModule>>;
let queuedResponses: Response[] = [];
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let now = 0;
const originalDateNow = Date.now;

function requestUrl(input: URL | RequestInfo): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

before(async () => {
  process.env.VITE_API_BASE_URL = 'https://api.example.test';
  api = await importApiModule();
});

beforeEach(() => {
  localStorage.clear();
  cookieJar.clear();
  queuedResponses = [];
  fetchCalls = [];
  now = 0;
  Date.now = () => now;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const nextResponse = queuedResponses.shift();
    assert.ok(nextResponse, 'Expected a queued fetch response');
    fetchCalls.push({ url: requestUrl(input), init });
    return nextResponse;
  }) as typeof fetch;
  api.setSession(session);
});

afterEach(() => {
  Date.now = originalDateNow;
  globalThis.dispatchEvent = originalDispatchEvent;
});

function queueJsonResponse(body: unknown): void {
  queuedResponses.push(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function queueNoContentResponse(): void {
  queuedResponses.push(new Response(null, { status: 204 }));
}

describe('frontend API caching', () => {
  it('upgrades stored sessions that predate the admin flag', () => {
    cookieJar.cookie = `bandmap-session=${encodeURIComponent(
      JSON.stringify({
        sessionToken: 'legacy-session-token',
        refreshToken: 'legacy-refresh-token',
        expiresAt: 60_000,
        user: {
          id: 'legacy-user',
          username: 'legacy',
          cognitoSub: 'legacy-cognito-sub',
          createdAt: 1735689600,
        },
      }),
    )}; path=/; SameSite=Strict`;

    assert.equal(api.hasSession(), true);
    assert.deepEqual(api.getCurrentUser(), {
      id: 'legacy-user',
      username: 'legacy',
      isAdmin: false,
      cognitoSub: 'legacy-cognito-sub',
      createdAt: 1735689600,
    });
  });

  it('keeps the session for 30 days', () => {
    now = session.session.expiresIn * 1000 + 1;
    assert.equal(api.hasSession(), true);

    now = 30 * 24 * 60 * 60 * 1000 + 1;
    assert.equal(api.hasSession(), false);
  });

  it('does not dispatch session updates while reading a missing session', () => {
    cookieJar.clear();

    let sessionUpdateCount = 0;
    globalThis.dispatchEvent = ((event: Event) => {
      if (event.type === 'bandmap:session-updated') {
        sessionUpdateCount += 1;
      }
      return true;
    }) as typeof globalThis.dispatchEvent;

    assert.equal(api.hasSession(), false);
    assert.equal(api.getCurrentUser(), null);

    assert.equal(sessionUpdateCount, 0);
  });

  it('clears malformed session cookies without dispatching a session update', () => {
    cookieJar.clear();
    cookieJar.cookie = 'bandmap-session=not-json; path=/; SameSite=Strict';

    let sessionUpdateCount = 0;
    globalThis.dispatchEvent = ((event: Event) => {
      if (event.type === 'bandmap:session-updated') {
        sessionUpdateCount += 1;
      }
      return true;
    }) as typeof globalThis.dispatchEvent;

    assert.equal(api.getCurrentUser(), null);
    assert.equal(cookieJar.cookie, '');

    assert.equal(sessionUpdateCount, 0);
  });

  it('caches ratings responses for at least one minute', async () => {
    const firstResponse: RatingsListResponse = { ratings: [ratedArtist] };
    const secondResponse: RatingsListResponse = { ratings: [olderRatedArtist] };

    queueJsonResponse(firstResponse);
    const firstRatings = await api.listRatings('rated');
    now = 30_000;
    const cachedRatings = await api.listRatings('rated');
    now = 61_000;
    queueJsonResponse(secondResponse);
    const refreshedRatings = await api.listRatings('rated');

    assert.deepEqual(firstRatings, firstResponse);
    assert.deepEqual(cachedRatings, firstResponse);
    assert.deepEqual(refreshedRatings, secondResponse);
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[0]?.url, 'https://api.example.test/ratings?status=rated');
    assert.equal(fetchCalls[1]?.url, 'https://api.example.test/ratings?status=rated');
  });

  it('updates cached ratings lists after saving a rating', async () => {
    queueJsonResponse({ ratings: [todoArtist, olderRatedArtist] } satisfies RatingsListResponse);
    queueJsonResponse({ ratings: [olderRatedArtist] } satisfies RatingsListResponse);
    queueJsonResponse({ ratings: [todoArtist] } satisfies RatingsListResponse);

    await api.listRatings();
    await api.listRatings('rated');
    await api.listRatings('todo');

    const updatedRating: Rating = {
      ...todoArtist,
      score: 4,
      status: 'rated',
      updatedAt: 1735948800,
    };
    queueJsonResponse({ rating: updatedRating });
    await api.putRating(updatedRating.artistId, { score: 4, status: 'rated' });

    const allRatings = await api.listRatings();
    const ratedRatings = await api.listRatings('rated');
    const todoRatings = await api.listRatings('todo');

    assert.equal(fetchCalls.length, 4);
    assert.deepEqual(allRatings.ratings, [olderRatedArtist, updatedRating]);
    assert.deepEqual(ratedRatings.ratings, [olderRatedArtist, updatedRating]);
    assert.deepEqual(todoRatings.ratings, []);
  });

  it('removes deleted artists from cached rating lists', async () => {
    queueJsonResponse({ ratings: [ratedArtist, todoArtist] } satisfies RatingsListResponse);
    queueJsonResponse({ ratings: [ratedArtist] } satisfies RatingsListResponse);
    queueJsonResponse({ ratings: [todoArtist] } satisfies RatingsListResponse);

    await api.listRatings();
    await api.listRatings('rated');
    await api.listRatings('todo');

    queueNoContentResponse();
    await api.deleteRating(todoArtist.artistId);

    const allRatings = await api.listRatings();
    const ratedRatings = await api.listRatings('rated');
    const todoRatings = await api.listRatings('todo');

    assert.equal(fetchCalls.length, 4);
    assert.deepEqual(allRatings.ratings, [ratedArtist]);
    assert.deepEqual(ratedRatings.ratings, [ratedArtist]);
    assert.deepEqual(todoRatings.ratings, []);
  });

  it('caches recommendations and refreshes the cache after generation', async () => {
    queueJsonResponse(recommendations);

    const initialRecommendations = await api.getRecommendations();
    const cachedRecommendations = await api.getRecommendations();

    const generatedRecommendations: RecommendationsResponse = {
      recommendations: [
        {
          ...recommendations.recommendations[0],
          artistId: 'artist-rec-2',
          artistName: 'Fresh Recommendation',
          generatedAt: 1735948800,
        },
      ],
    };

    queueJsonResponse(generatedRecommendations);
    const refreshedRecommendations = await api.generateRecommendations();
    const cachedGeneratedRecommendations = await api.getRecommendations();

    assert.deepEqual(initialRecommendations, recommendations);
    assert.deepEqual(cachedRecommendations, recommendations);
    assert.deepEqual(refreshedRecommendations, generatedRecommendations);
    assert.deepEqual(cachedGeneratedRecommendations, generatedRecommendations);
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[0]?.url, 'https://api.example.test/recommendations');
    assert.equal(fetchCalls[1]?.url, 'https://api.example.test/recommendations/generate');
  });

  it('loads the latest invite link for admin sessions', async () => {
    queueJsonResponse({
      invite: {
        code: 'INVITE-1',
        inviteUrl: 'https://music.heap.fi/#invite?code=INVITE-1',
        createdAt: 1735862400,
        expiresAt: 1738454400,
        remainingUses: 8,
      },
    });

    const response = await api.getLatestInviteLink();

    assert.equal(response.invite.code, 'INVITE-1');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.url, 'https://api.example.test/invites/latest');
    assert.equal(
      (fetchCalls[0]?.init?.headers as Record<string, string> | undefined)?.['Authorization'],
      'Bearer session-token',
    );
  });
});
