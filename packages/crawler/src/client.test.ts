import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LastFmClient, LastFmApiError } from './client.js';

// Load sample responses from doc/ directory
const sampleDir = resolve(import.meta.dirname, '../../../doc');
const sampleGetInfo = JSON.parse(readFileSync(resolve(sampleDir, 'sample.artist.getinfo.json'), 'utf-8'));
const sampleGetSimilar = JSON.parse(readFileSync(resolve(sampleDir, 'sample.artist.getsimilar.json'), 'utf-8'));

/**
 * Create a mock fetch that returns canned responses based on the method parameter.
 */
function mockFetch(responses: Map<string, unknown>): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
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

describe('LastFmClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('getArtistInfo', () => {
    it('parses artist info from sample response', async () => {
      const responses = new Map<string, unknown>();
      responses.set('artist.getinfo', sampleGetInfo);
      globalThis.fetch = mockFetch(responses);

      const client = new LastFmClient('test-api-key');
      const result = await client.getArtistInfo('79489e1b-5658-4e5f-8841-3e313946dc4d');

      assert.equal(result.artist.name, 'Rosetta');
      assert.equal(result.artist.mbid, '79489e1b-5658-4e5f-8841-3e313946dc4d');
      assert.equal(result.artist.url, 'https://www.last.fm/music/Rosetta');
      assert.equal(result.artist.tags.length, 5);
      assert.equal(result.artist.tags[0].name, 'post-metal');
      assert.ok(result.artist.tags[0].id, 'tag should have an id');
      assert.equal(result.artist.tags[0].url, 'https://www.last.fm/tag/post-metal');
    });

    it('extracts all tags with names and urls', async () => {
      const responses = new Map<string, unknown>();
      responses.set('artist.getinfo', sampleGetInfo);
      globalThis.fetch = mockFetch(responses);

      const client = new LastFmClient('test-api-key');
      const result = await client.getArtistInfo('79489e1b-5658-4e5f-8841-3e313946dc4d');

      const tagNames = result.artist.tags.map((t) => t.name);
      assert.deepEqual(tagNames, ['post-metal', 'sludge', 'post-rock', 'ambient', 'post-hardcore']);
    });
  });

  describe('getSimilarArtists', () => {
    it('parses similar artists from sample response', async () => {
      const responses = new Map<string, unknown>();
      responses.set('artist.getsimilar', sampleGetSimilar);
      globalThis.fetch = mockFetch(responses);

      const client = new LastFmClient('test-api-key');
      const result = await client.getSimilarArtists('79489e1b-5658-4e5f-8841-3e313946dc4d');

      assert.equal(result.length, 3);

      assert.equal(result[0].name, 'Cult of Luna');
      assert.equal(result[0].mbid, 'd347406f-839d-4423-9a28-188939282afa');
      assert.equal(result[0].match, 1);
      assert.equal(result[0].url, 'https://www.last.fm/music/Cult+of+Luna');

      assert.equal(result[1].name, 'Isis');
      assert.equal(result[1].match, 0.927844);

      assert.equal(result[2].name, 'Mouth of the Architect');
      assert.equal(result[2].match, 0.768387);
    });

    it('returns empty array for empty similar list', async () => {
      const responses = new Map<string, unknown>();
      responses.set('artist.getsimilar', { similarartists: { artist: [] } });
      globalThis.fetch = mockFetch(responses);

      const client = new LastFmClient('test-api-key');
      const result = await client.getSimilarArtists('some-mbid');
      assert.equal(result.length, 0);
    });

    it('handles missing mbid in similar artist', async () => {
      const responses = new Map<string, unknown>();
      responses.set('artist.getsimilar', {
        similarartists: {
          artist: [
            { name: 'No MBID Artist', mbid: '', match: '0.5', url: 'https://last.fm/test' },
          ],
        },
      });
      globalThis.fetch = mockFetch(responses);

      const client = new LastFmClient('test-api-key');
      const result = await client.getSimilarArtists('some-mbid');
      assert.equal(result.length, 1);
      assert.equal(result[0].mbid, '');
      assert.equal(result[0].name, 'No MBID Artist');
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

      const client = new LastFmClient('test-api-key');
      await assert.rejects(
        () => client.getArtistInfo('some-mbid'),
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

      const client = new LastFmClient('test-api-key');
      await assert.rejects(
        () => client.getArtistInfo('some-mbid'),
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

      const client = new LastFmClient('test-api-key');
      await assert.rejects(
        () => client.getArtistInfo('some-mbid'),
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

      const client = new LastFmClient('test-api-key');
      await assert.rejects(
        () => client.getArtistInfo('nonexistent'),
        (err: unknown) => {
          assert.ok(err instanceof LastFmApiError);
          return true;
        },
      );
    });

    it('throws if API key is empty', () => {
      assert.throws(() => new LastFmClient(''), /LASTFM_API_KEY is required/);
    });
  });
});
