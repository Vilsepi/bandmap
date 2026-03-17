import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { formatEpochSeconds, getExternalLinkIconClass } from './utils.js';

describe('formatEpochSeconds', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('converts Unix epoch seconds to a locale-formatted date', () => {
    const toLocaleString = mock.method(
      Date.prototype,
      'toLocaleString',
      function toLocaleStringStub(this: Date) {
        return this.toISOString();
      },
    );

    const formatted = formatEpochSeconds(1738454400);

    assert.equal(formatted, '2025-02-02T00:00:00.000Z');
    assert.equal(toLocaleString.mock.calls.length, 1);
  });
});

describe('getExternalLinkIconClass', () => {
  it('returns the Last.fm icon for Last.fm hosts', () => {
    assert.equal(
      getExternalLinkIconClass('https://www.last.fm/music/Autechre'),
      'fa-brands fa-lastfm',
    );
  });

  it('returns the Spotify icon for Spotify hosts', () => {
    assert.equal(
      getExternalLinkIconClass('https://open.spotify.com/artist/xyz'),
      'fa-brands fa-spotify',
    );
  });

  it('does not trust hostnames embedded in another URL', () => {
    assert.equal(
      getExternalLinkIconClass(
        'https://evil.example/redirect?target=https://spotify.com/artist/xyz',
      ),
      'fa-regular fa-circle-play',
    );
    assert.equal(
      getExternalLinkIconClass('https://evil.example/last.fm'),
      'fa-regular fa-circle-play',
    );
  });

  it('falls back for invalid URLs', () => {
    assert.equal(getExternalLinkIconClass('not-a-url'), 'fa-regular fa-circle-play');
  });
});
