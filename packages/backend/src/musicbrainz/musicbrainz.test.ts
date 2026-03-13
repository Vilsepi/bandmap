import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { searchArtistMbid, getSpotifyUrl } from './musicbrainz.js';

const sampleDir = resolve(import.meta.dirname, '../../../../doc/samples');
const sampleSearch = JSON.parse(
  readFileSync(resolve(sampleDir, 'musicbrainz_search.json'), 'utf-8'),
);
const sampleLookup = JSON.parse(
  readFileSync(resolve(sampleDir, 'musicbrainz_lookup.json'), 'utf-8'),
);

function mockFetch(body: unknown, ok = true): typeof globalThis.fetch {
  return (async () => ({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: async () => body,
  })) as unknown as typeof globalThis.fetch;
}

describe('musicbrainz', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('searchArtistMbid', () => {
    it('returns the MBID for an exact match (score 100)', async () => {
      globalThis.fetch = mockFetch(sampleSearch);

      const mbid = await searchArtistMbid('Glasgow Coma Scale');
      assert.equal(mbid, '5ca3c7f7-370c-4829-98f0-b33ff3cbc584');
    });

    it('returns null when no exact match exists', async () => {
      globalThis.fetch = mockFetch({
        artists: [{ id: 'abc', name: 'Close Match', score: 85 }],
        count: 1,
        offset: 0,
      });

      const mbid = await searchArtistMbid('Non-existent Artist');
      assert.equal(mbid, null);
    });

    it('returns null when the API returns an error', async () => {
      globalThis.fetch = mockFetch({}, false);

      const mbid = await searchArtistMbid('Error Case');
      assert.equal(mbid, null);
    });
  });

  describe('getSpotifyUrl', () => {
    it('extracts the Spotify URL from url-rels', async () => {
      globalThis.fetch = mockFetch(sampleLookup);

      const url = await getSpotifyUrl('5ca3c7f7-370c-4829-98f0-b33ff3cbc584');
      assert.equal(url, 'https://open.spotify.com/artist/3OilnTuGkR6gZKZa0sV8E8');
    });

    it('returns null when no Spotify relation exists', async () => {
      globalThis.fetch = mockFetch({
        id: 'abc',
        name: 'No Spotify',
        relations: [{ type: 'bandcamp', url: { resource: 'https://example.bandcamp.com/' } }],
      });

      const url = await getSpotifyUrl('abc');
      assert.equal(url, null);
    });

    it('returns null when relations array is missing', async () => {
      globalThis.fetch = mockFetch({
        id: 'abc',
        name: 'No Relations',
      });

      const url = await getSpotifyUrl('abc');
      assert.equal(url, null);
    });

    it('returns null when the API returns an error', async () => {
      globalThis.fetch = mockFetch({}, false);

      const url = await getSpotifyUrl('abc');
      assert.equal(url, null);
    });
  });
});
