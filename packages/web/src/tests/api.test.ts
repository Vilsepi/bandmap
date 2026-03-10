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

const localStorage = new LocalStorageMock();

const session: AuthSessionResponse = {
  user: {
    id: 'user-1',
    username: 'tester',
    cognitoSub: 'cognito-sub-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  session: {
    sessionToken: 'session-token',
    refreshToken: 'refresh-token',
    expiresIn: 3600,
  },
};

const ratedArtist: Rating = {
  userId: 'user-1',
  artistMbid: 'artist-rated',
  score: 5,
  status: 'rated',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const todoArtist: Rating = {
  userId: 'user-1',
  artistMbid: 'artist-todo',
  score: null,
  status: 'todo',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const olderRatedArtist: Rating = {
  userId: 'user-1',
  artistMbid: 'artist-old-rated',
  score: 3,
  status: 'rated',
  updatedAt: '2025-12-31T00:00:00.000Z',
};

const recommendations: RecommendationsResponse = {
  recommendations: [
    {
      userId: 'user-1',
      artistMbid: 'artist-rec-1',
      artistName: 'Recommended Artist',
      score: 0.91,
      sourceArtistMbid: 'artist-rated',
      sourceArtistName: 'Rated Artist',
      generatedAt: '2026-01-03T00:00:00.000Z',
    },
  ],
};

Object.assign(globalThis, { localStorage });

type ApiModule = typeof import('../api.js');

let api: ApiModule;
let queuedResponses: Response[] = [];
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let now = 0;
const originalDateNow = Date.now;

before(async () => {
  process.env.VITE_API_BASE_URL = 'https://api.example.test';
  api = await import('../api.js');
});

beforeEach(() => {
  localStorage.clear();
  queuedResponses = [];
  fetchCalls = [];
  now = 0;
  Date.now = () => now;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const nextResponse = queuedResponses.shift();
    assert.ok(nextResponse, 'Expected a queued fetch response');
    fetchCalls.push({ url: String(input), init });
    return nextResponse;
  }) as typeof fetch;
  api.setSession(session);
});

afterEach(() => {
  Date.now = originalDateNow;
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
      updatedAt: '2026-01-04T00:00:00.000Z',
    };
    queueJsonResponse({ rating: updatedRating });
    await api.putRating(updatedRating.artistMbid, { score: 4, status: 'rated' });

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
    await api.deleteRating(todoArtist.artistMbid);

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
          artistMbid: 'artist-rec-2',
          artistName: 'Fresh Recommendation',
          generatedAt: '2026-01-04T00:00:00.000Z',
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
});
