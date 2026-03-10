import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Artist, Rating, RelatedArtist } from '@bandmap/shared';
import { findArtistRating, renderArtistDetail } from './artist-detail.js';

Object.assign(globalThis, {
  document: {
    createElement: () => {
      let text = '';
      return {
        set textContent(value: string) {
          text = value;
        },
        get innerHTML(): string {
          return text
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
        },
      };
    },
  },
});

const artist: Artist = {
  mbid: 'artist-1',
  name: 'Test Artist',
  url: 'https://example.com/artist-1',
  tags: ['post-metal', 'doom'],
  fetchedAt: '2026-01-01T00:00:00.000Z',
};

const related: RelatedArtist[] = [
  {
    sourceMbid: 'artist-1',
    targetMbid: 'artist-2',
    targetName: 'Related Artist',
    match: 0.81,
    fetchedAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('artist detail view state', () => {
  it('finds the current artist rating from the ratings list', () => {
    const ratings: Rating[] = [
      {
        userId: 'user-1',
        artistMbid: 'artist-2',
        score: null,
        status: 'todo',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        userId: 'user-1',
        artistMbid: 'artist-1',
        score: 4,
        status: 'rated',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ];

    assert.deepEqual(findArtistRating(ratings, 'artist-1'), ratings[1]);
    assert.equal(findArtistRating(ratings, 'missing-artist'), null);
  });

  it('renders the current star rating when the artist is rated', () => {
    const html = renderArtistDetail(artist, related, {
      userId: 'user-1',
      artistMbid: 'artist-1',
      score: 3,
      status: 'rated',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    assert.equal(html.match(/class="star active"/g)?.length, 3);
    assert.match(html, /aria-label="Add to todo"/);
    assert.doesNotMatch(html, /id="btn-todo"[\s\S]*disabled/);
  });

  it('renders the todo bookmark state when the artist is saved for later', () => {
    const html = renderArtistDetail(artist, related, {
      userId: 'user-1',
      artistMbid: 'artist-1',
      score: null,
      status: 'todo',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    assert.equal(html.match(/class="star active"/g)?.length ?? 0, 0);
    assert.match(html, /aria-label="Added to todo"/);
    assert.match(html, /id="btn-todo"[\s\S]*disabled/);
    assert.match(html, /fa-solid fa-bookmark/);
  });
});
