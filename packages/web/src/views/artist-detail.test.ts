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
  aid: 'artist-1',
  name: 'Test Artist',
  lastFmUrl: 'https://example.com/artist-1',
  tags: ['post-metal', 'doom'],
  fetchedAt: 1735689600,
};

const related: RelatedArtist[] = [
  {
    sourceAid: 'artist-1',
    targetAid: 'artist-2',
    targetName: 'Related Artist',
    targetLastFmUrl: 'https://example.com/artist-2',
    match: 0.81,
    fetchedAt: 1735689600,
  },
];

describe('artist detail view state', () => {
  it('finds the current artist rating from the ratings list', () => {
    const ratings: Rating[] = [
      {
        userId: 'user-1',
        artistAid: 'artist-2',
        score: null,
        status: 'todo',
        updatedAt: 1735689600,
      },
      {
        userId: 'user-1',
        artistAid: 'artist-1',
        score: 4,
        status: 'rated',
        updatedAt: 1735776000,
      },
    ];

    assert.deepEqual(findArtistRating(ratings, 'artist-1'), ratings[1]);
    assert.equal(findArtistRating(ratings, 'missing-artist'), null);
  });

  it('renders the current star rating when the artist is rated', () => {
    const html = renderArtistDetail(artist, related, {
      userId: 'user-1',
      artistAid: 'artist-1',
      score: 3,
      status: 'rated',
      updatedAt: 1735776000,
    });

    assert.equal(html.match(/class="star active"/g)?.length, 3);
    assert.match(html, /aria-label="Add to todo"/);
    assert.doesNotMatch(html, /id="btn-todo"[\s\S]*disabled/);
  });

  it('renders the todo bookmark state when the artist is saved for later', () => {
    const html = renderArtistDetail(artist, related, {
      userId: 'user-1',
      artistAid: 'artist-1',
      score: null,
      status: 'todo',
      updatedAt: 1735776000,
    });

    assert.equal(html.match(/class="star active"/g)?.length ?? 0, 0);
    assert.match(html, /aria-label="Added to todo"/);
    assert.match(html, /id="btn-todo"[\s\S]*disabled/);
    assert.match(html, /fa-solid fa-bookmark/);
  });
});
