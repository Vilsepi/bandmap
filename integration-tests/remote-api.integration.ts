import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchArtistInfo } from '../packages/backend/src/lastfm/lastfm.js';
import {
  getSpotifyUrl,
  searchArtistMbid,
} from '../packages/backend/src/musicbrainz/musicbrainz.js';

const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const REMOTE_CALL_INTERVAL_MS = 1100;

let nextAllowedCallTimestamp = 0;
let rateLimitQueue = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkUnavailable(error: unknown): boolean {
  if (!(error instanceof TypeError) || !('cause' in error)) {
    return false;
  }

  const cause = error.cause;
  if (!(cause instanceof Error) || !('code' in cause)) {
    return false;
  }

  return cause.code === 'ENOTFOUND' || cause.code === 'EAI_AGAIN';
}

function runRateLimited<T>(operation: () => Promise<T>): Promise<T> {
  const scheduled = rateLimitQueue.then(async () => {
    const waitMs = Math.max(0, nextAllowedCallTimestamp - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    try {
      return await operation();
    } finally {
      nextAllowedCallTimestamp = Date.now() + REMOTE_CALL_INTERVAL_MS;
    }
  });

  rateLimitQueue = scheduled.then(
    () => undefined,
    () => undefined,
  );

  return scheduled;
}

describe('remote API integration', () => {
  const itLastFm = LASTFM_API_KEY ? it : it.skip;

  itLastFm('fetches artist info from Last.fm for Rosetta', async (t) => {
    if (!LASTFM_API_KEY) {
      t.skip('LASTFM_API_KEY is not set');
      return;
    }

    let artist;
    try {
      artist = await runRateLimited(() =>
        fetchArtistInfo({ mbid: '79489e1b-5658-4e5f-8841-3e313946dc4d' }, LASTFM_API_KEY),
      );
    } catch (error) {
      if (isNetworkUnavailable(error)) {
        t.skip('Last.fm is unreachable from this environment');
        return;
      }
      throw error;
    }

    assert.equal(artist.name, 'Rosetta');
    assert.equal(artist.mbid, '79489e1b-5658-4e5f-8841-3e313946dc4d');
    assert.equal(artist.lastFmUrl, 'https://www.last.fm/music/Rosetta');
    assert.ok(artist.tags.some((tag) => tag.name === 'post-metal'));
  });

  it('searches MusicBrainz for Glasgow Coma Scale', async (t) => {
    let mbid;
    try {
      mbid = await runRateLimited(() => searchArtistMbid('Glasgow Coma Scale'));
    } catch (error) {
      if (isNetworkUnavailable(error)) {
        t.skip('MusicBrainz is unreachable from this environment');
        return;
      }
      throw error;
    }

    assert.equal(mbid, '5ca3c7f7-370c-4829-98f0-b33ff3cbc584');
  });

  it('looks up a Spotify URL from MusicBrainz', async (t) => {
    let spotifyUrl;
    try {
      spotifyUrl = await runRateLimited(() =>
        getSpotifyUrl('5ca3c7f7-370c-4829-98f0-b33ff3cbc584'),
      );
    } catch (error) {
      if (isNetworkUnavailable(error)) {
        t.skip('MusicBrainz is unreachable from this environment');
        return;
      }
      throw error;
    }

    assert.equal(spotifyUrl, 'https://open.spotify.com/artist/3OilnTuGkR6gZKZa0sV8E8');
  });
});
