import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { searchArtistMbid, getSpotifyUrl } from './musicbrainz.js';
import { logger } from '../log.js';

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
  const originalDebug = logger.debug;
  const originalWarn = logger.warn;
  const debugCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];

  beforeEach(() => {
    logger.debug = ((...args: unknown[]) => {
      debugCalls.push(args);
    }) as typeof logger.debug;

    logger.warn = ((...args: unknown[]) => {
      warnCalls.push(args);
    }) as typeof logger.warn;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    debugCalls.length = 0;
    warnCalls.length = 0;
    logger.debug = originalDebug;
    logger.warn = originalWarn;
  });

  describe('searchArtistMbid', () => {
    it('returns the MBID for an exact match (score 100)', async () => {
      globalThis.fetch = mockFetch(sampleSearch);

      const mbid = await searchArtistMbid('Glasgow Coma Scale');
      assert.equal(mbid, '5ca3c7f7-370c-4829-98f0-b33ff3cbc584');
      assert.deepEqual(debugCalls.at(-1), [
        {
          artistName: 'Glasgow Coma Scale',
          mbid: '5ca3c7f7-370c-4829-98f0-b33ff3cbc584',
        },
        'Found MusicBrainz MBID match for artist',
      ]);
    });

    it('returns null when no exact match exists', async () => {
      globalThis.fetch = mockFetch({
        artists: [{ id: 'abc', name: 'Close Match', score: 85 }],
        count: 1,
        offset: 0,
      });

      const mbid = await searchArtistMbid('Non-existent Artist');
      assert.equal(mbid, null);
      assert.deepEqual(debugCalls.at(-1), [
        {
          artistName: 'Non-existent Artist',
          mbid: null,
        },
        'No MusicBrainz MBID match for artist',
      ]);
    });

    it('returns null when the API returns an error', async () => {
      globalThis.fetch = mockFetch({}, false);

      const mbid = await searchArtistMbid('Error Case');
      assert.equal(mbid, null);
      assert.deepEqual(warnCalls.at(-1), [
        {
          artistName: 'Error Case',
          statusCode: 500,
          statusText: 'Internal Server Error',
          url: 'https://musicbrainz.org/ws/2/artist?query=artist:Error%20Case&fmt=json&limit=5',
        },
        'MusicBrainz artist search returned bad response',
      ]);
    });
  });

  describe('getSpotifyUrl', () => {
    it('extracts the Spotify URL from url-rels', async () => {
      globalThis.fetch = mockFetch(sampleLookup);

      const url = await getSpotifyUrl('5ca3c7f7-370c-4829-98f0-b33ff3cbc584');
      assert.equal(url, 'https://open.spotify.com/artist/3OilnTuGkR6gZKZa0sV8E8');
      assert.deepEqual(debugCalls.at(-1), [
        {
          mbid: '5ca3c7f7-370c-4829-98f0-b33ff3cbc584',
          spotifyUrl: 'https://open.spotify.com/artist/3OilnTuGkR6gZKZa0sV8E8',
        },
        'Found Spotify URL for MusicBrainz artist',
      ]);
    });

    it('returns null when no Spotify relation exists', async () => {
      globalThis.fetch = mockFetch({
        id: 'abc',
        name: 'No Spotify',
        relations: [{ type: 'bandcamp', url: { resource: 'https://example.bandcamp.com/' } }],
      });

      const url = await getSpotifyUrl('abc');
      assert.equal(url, null);
      assert.deepEqual(debugCalls.at(-1), [
        {
          mbid: 'abc',
          spotifyUrl: null,
        },
        'No Spotify URL found for MusicBrainz artist',
      ]);
    });

    it('returns null when relations array is missing', async () => {
      globalThis.fetch = mockFetch({
        id: 'abc',
        name: 'No Relations',
      });

      const url = await getSpotifyUrl('abc');
      assert.equal(url, null);
      assert.deepEqual(debugCalls.at(-1), [
        {
          mbid: 'abc',
          spotifyUrl: null,
        },
        'No Spotify URL found for MusicBrainz artist',
      ]);
    });

    it('returns null when the API returns an error', async () => {
      globalThis.fetch = mockFetch({}, false);

      const url = await getSpotifyUrl('abc');
      assert.equal(url, null);
      assert.deepEqual(warnCalls.at(-1), [
        {
          mbid: 'abc',
          statusCode: 500,
          statusText: 'Internal Server Error',
          url: 'https://musicbrainz.org/ws/2/artist/abc?inc=url-rels&fmt=json',
        },
        'MusicBrainz artist lookup returned bad response',
      ]);
    });
  });
});
