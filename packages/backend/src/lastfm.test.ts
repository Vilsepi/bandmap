import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fetchArtistInfo,
  fetchSimilarArtists,
  searchArtists,
  LastFmApiError,
  Semaphore,
} from './lastfm.js';

// Load sample responses from doc/ directory
const sampleDir = resolve(import.meta.dirname, '../../../doc');
const sampleGetInfo = JSON.parse(
  readFileSync(resolve(sampleDir, 'sample.artist.getinfo.json'), 'utf-8'),
);
const sampleGetSimilar = JSON.parse(
  readFileSync(resolve(sampleDir, 'sample.artist.getsimilar.json'), 'utf-8'),
);

type FetchInput = string | URL | Request;

/**
 * Create a mock fetch that returns canned responses based on the method parameter.
 */
function mockFetch(responses: Map<string, unknown>): typeof globalThis.fetch {
  return (async (input: FetchInput) => {
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else {
      url = input.url;
    }
    const params = new URL(url).searchParams;
    const method = params.get('method') ?? '';

    const body = responses.get(method);
    if (!body) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 6, message: 'Artist not found' }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    } as Response;
  }) as typeof globalThis.fetch;
}

describe('lastfm', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('fetchArtistInfo', () => {
    it('parses artist info from sample response', async () => {
      const responses = new Map<string, unknown>();
      responses.set('artist.getinfo', sampleGetInfo);
      globalThis.fetch = mockFetch(responses);

      const result = await fetchArtistInfo('79489e1b-5658-4e5f-8841-3e313946dc4d', 'test-api-key');

      assert.equal(result.name, 'Rosetta');
      assert.equal(result.mbid, '79489e1b-5658-4e5f-8841-3e313946dc4d');
      assert.equal(result.url, 'https://www.last.fm/music/Rosetta');
      assert.equal(result.tags.length, 5);
      assert.equal(result.tags[0], 'post-metal');
      assert.ok(result.fetchedAt, 'should have a fetchedAt timestamp');
    });

    it('extracts all tag names', async () => {
      const responses = new Map<string, unknown>();
      responses.set('artist.getinfo', sampleGetInfo);
      globalThis.fetch = mockFetch(responses);

      const result = await fetchArtistInfo('79489e1b-5658-4e5f-8841-3e313946dc4d', 'test-api-key');

      assert.deepEqual(result.tags, [
        'post-metal',
        'sludge',
        'post-rock',
        'ambient',
        'post-hardcore',
      ]);
    });
  });

  describe('fetchSimilarArtists', () => {
    it('parses similar artists from sample response', async () => {
      const responses = new Map<string, unknown>();
      responses.set('artist.getsimilar', sampleGetSimilar);
      globalThis.fetch = mockFetch(responses);

      const result = await fetchSimilarArtists(
        '79489e1b-5658-4e5f-8841-3e313946dc4d',
        'test-api-key',
      );

      assert.equal(result.length, 3);

      assert.equal(result[0].targetName, 'Cult of Luna');
      assert.equal(result[0].targetMbid, 'd347406f-839d-4423-9a28-188939282afa');
      assert.equal(result[0].match, 1);
      assert.equal(result[0].sourceMbid, '79489e1b-5658-4e5f-8841-3e313946dc4d');

      assert.equal(result[1].targetName, 'Isis');
      assert.equal(result[1].match, 0.927844);

      assert.equal(result[2].targetName, 'Mouth of the Architect');
      assert.equal(result[2].match, 0.768387);
    });

    it('returns empty array for empty similar list', async () => {
      const responses = new Map<string, unknown>();
      responses.set('artist.getsimilar', { similarartists: { artist: [] } });
      globalThis.fetch = mockFetch(responses);

      const result = await fetchSimilarArtists('some-mbid', 'test-api-key');
      assert.equal(result.length, 0);
    });

    it('filters out artists with empty mbid', async () => {
      const responses = new Map<string, unknown>();
      responses.set('artist.getsimilar', {
        similarartists: {
          artist: [{ name: 'No MBID Artist', mbid: '', match: '0.5', url: 'https://last.fm/test' }],
        },
      });
      globalThis.fetch = mockFetch(responses);

      const result = await fetchSimilarArtists('some-mbid', 'test-api-key');
      assert.equal(result.length, 0);
    });
  });

  describe('searchArtists', () => {
    it('parses search results', async () => {
      const responses = new Map<string, unknown>();
      responses.set('artist.search', {
        results: {
          artistmatches: {
            artist: [
              {
                name: 'Rosetta',
                mbid: '79489e1b-5658-4e5f-8841-3e313946dc4d',
                url: 'https://www.last.fm/music/Rosetta',
              },
            ],
          },
        },
      });
      globalThis.fetch = mockFetch(responses);

      const result = await searchArtists('Rosetta', 'test-api-key');
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'Rosetta');
      assert.equal(result[0].mbid, '79489e1b-5658-4e5f-8841-3e313946dc4d');
    });

    it('filters out results without mbid', async () => {
      const responses = new Map<string, unknown>();
      responses.set('artist.search', {
        results: {
          artistmatches: {
            artist: [
              { name: 'No MBID', mbid: '', url: 'https://last.fm/test' },
              {
                name: 'Has MBID',
                mbid: 'abc-123',
                url: 'https://last.fm/test2',
              },
            ],
          },
        },
      });
      globalThis.fetch = mockFetch(responses);

      const result = await searchArtists('test', 'test-api-key');
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'Has MBID');
    });
  });

  describe('error handling', () => {
    it('throws LastFmApiError on HTTP error', async () => {
      globalThis.fetch = (async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      })) as unknown as typeof globalThis.fetch;

      await assert.rejects(
        () => fetchArtistInfo('some-mbid', 'test-api-key'),
        (err: unknown) => {
          assert.ok(err instanceof LastFmApiError);
          assert.equal(err.statusCode, 500);
          assert.equal(err.retryable, true);
          return true;
        },
      );
    });

    it('throws non-retryable error on 4xx', async () => {
      globalThis.fetch = (async () => ({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({}),
      })) as unknown as typeof globalThis.fetch;

      await assert.rejects(
        () => fetchArtistInfo('some-mbid', 'test-api-key'),
        (err: unknown) => {
          assert.ok(err instanceof LastFmApiError);
          assert.equal(err.retryable, false);
          return true;
        },
      );
    });

    it('throws retryable error on 429', async () => {
      globalThis.fetch = (async () => ({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({}),
      })) as unknown as typeof globalThis.fetch;

      await assert.rejects(
        () => fetchArtistInfo('some-mbid', 'test-api-key'),
        (err: unknown) => {
          assert.ok(err instanceof LastFmApiError);
          assert.equal(err.retryable, true);
          return true;
        },
      );
    });

    it('throws on Last.fm inline error response', async () => {
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ error: 6, message: 'Artist not found' }),
      })) as unknown as typeof globalThis.fetch;

      await assert.rejects(
        () => fetchArtistInfo('nonexistent', 'test-api-key'),
        (err: unknown) => {
          assert.ok(err instanceof LastFmApiError);
          return true;
        },
      );
    });
  });

  describe('retry with backoff', () => {
    it('retries on 429 and eventually succeeds', async () => {
      let callCount = 0;
      const responses = new Map<string, unknown>();
      responses.set('artist.getinfo', sampleGetInfo);

      globalThis.fetch = (async (input: FetchInput) => {
        callCount++;
        if (callCount <= 2) {
          return {
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            json: async () => ({}),
          } as Response;
        }
        // Third call succeeds
        return mockFetch(responses)(input);
      }) as typeof globalThis.fetch;

      const result = await fetchArtistInfo('79489e1b-5658-4e5f-8841-3e313946dc4d', 'test-api-key');
      assert.equal(result.name, 'Rosetta');
      assert.equal(callCount, 3);
    });

    it('retries on 500 and eventually succeeds', async () => {
      let callCount = 0;
      const responses = new Map<string, unknown>();
      responses.set('artist.getinfo', sampleGetInfo);

      globalThis.fetch = (async (input: FetchInput) => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => ({}),
          } as Response;
        }
        return mockFetch(responses)(input);
      }) as typeof globalThis.fetch;

      const result = await fetchArtistInfo('79489e1b-5658-4e5f-8841-3e313946dc4d', 'test-api-key');
      assert.equal(result.name, 'Rosetta');
      assert.equal(callCount, 2);
    });

    it('does not retry non-retryable errors', async () => {
      let callCount = 0;

      globalThis.fetch = (async () => {
        callCount++;
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({}),
        } as Response;
      }) as typeof globalThis.fetch;

      await assert.rejects(
        () => fetchArtistInfo('some-mbid', 'test-api-key'),
        (err: unknown) => {
          assert.ok(err instanceof LastFmApiError);
          assert.equal(err.retryable, false);
          return true;
        },
      );
      assert.equal(callCount, 1);
    });

    it('throws after exhausting retries', async () => {
      let callCount = 0;

      globalThis.fetch = (async () => {
        callCount++;
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: async () => ({}),
        } as Response;
      }) as typeof globalThis.fetch;

      await assert.rejects(
        () => fetchArtistInfo('some-mbid', 'test-api-key'),
        (err: unknown) => {
          assert.ok(err instanceof LastFmApiError);
          assert.equal(err.statusCode, 429);
          assert.equal(err.retryable, true);
          return true;
        },
      );
      // 1 initial + 3 retries = 4 total
      assert.equal(callCount, 4);
    });
  });

  describe('Semaphore', () => {
    it('limits concurrent access', async () => {
      const sem = new Semaphore(2);
      let running = 0;
      let maxRunning = 0;

      const task = async () => {
        await sem.acquire();
        running++;
        maxRunning = Math.max(maxRunning, running);
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        running--;
        sem.release();
      };

      await Promise.all([task(), task(), task(), task(), task()]);
      assert.equal(maxRunning, 2);
    });

    it('allows up to max concurrent', async () => {
      const sem = new Semaphore(3);

      // Acquire 3 — should all succeed immediately
      await sem.acquire();
      await sem.acquire();
      await sem.acquire();

      // 4th should block
      let acquired = false;
      const blocked = sem.acquire().then(() => {
        acquired = true;
      });

      // Give microtasks a chance to run
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(acquired, false);

      // Release one — the blocked one should now acquire
      sem.release();
      await blocked;
      assert.equal(acquired, true);

      // Clean up
      sem.release();
      sem.release();
      sem.release();
    });
  });
});
