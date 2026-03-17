import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Artist, Rating, RelatedArtist, Recommendation } from '@bandmap/shared';
import { generateRecommendationsWithDeps } from './recommendations.js';

const USER_ID = 'user-1';

function makeRating(artistId: string, score: number): Rating {
  return {
    userId: USER_ID,
    artistId,
    score,
    todo: false,
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

function makeArtist(artistId: string, name: string): Artist {
  return {
    artistId,
    name,
    lastFmUrl: `https://example.com/${artistId}`,
    tags: [],
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}

function makeRelated(
  sourceId: string,
  targetId: string,
  targetName: string,
  match: number,
): RelatedArtist {
  return {
    sourceId,
    targetId,
    targetName,
    targetLastFmUrl: `https://example.com/${targetId}`,
    match,
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}

describe('generateRecommendations scoring', () => {
  it('uses rating score when comparing recommendations', async () => {
    const seedA = 'seed-a';
    const seedB = 'seed-b';

    let written: Recommendation[] = [];
    const result = await generateRecommendationsWithDeps(USER_ID, {
      listRatings: async () => [makeRating(seedA, 5), makeRating(seedB, 4)],
      getArtist: async (artistId: string) =>
        artistId === seedA ? makeArtist(seedA, 'Seed A') : makeArtist(seedB, 'Seed B'),
      getOrFetchRelatedArtists: async (artistId: string) => {
        if (artistId === seedA) {
          return [makeRelated(seedA, 'target-x', 'Target X', 0.8)];
        }
        return [makeRelated(seedB, 'target-y', 'Target Y', 0.9)];
      },
      putRecommendations: async (_userId: string, items: Recommendation[]) => {
        written = items;
      },
    });

    assert.equal(result.length, 2);
    assert.equal(result[0]?.artistId, 'target-x');
    assert.equal(result[0]?.score, 4);
    assert.equal(result[1]?.artistId, 'target-y');
    assert.equal(result[1]?.score, 3.6);
    assert.deepEqual(written, result);
  });

  it('uses Last.fm similarity score when recommendations share the same rating seed', async () => {
    const seedA = 'seed-a';

    const result = await generateRecommendationsWithDeps(USER_ID, {
      listRatings: async () => [makeRating(seedA, 5)],
      getArtist: async () => makeArtist(seedA, 'Seed A'),
      getOrFetchRelatedArtists: async () => [
        makeRelated(seedA, 'target-low', 'Target Low', 0.2),
        makeRelated(seedA, 'target-high', 'Target High', 0.8),
      ],
      putRecommendations: async () => {},
    });

    assert.equal(result.length, 2);
    assert.equal(result[0]?.artistId, 'target-high');
    assert.equal(result[0]?.score, 4);
    assert.equal(result[1]?.artistId, 'target-low');
    assert.equal(result[1]?.score, 1);
  });

  it('does not persist Unknown when the source artist name is missing', async () => {
    const seedA = 'seed-a';

    const result = await generateRecommendationsWithDeps(USER_ID, {
      listRatings: async () => [makeRating(seedA, 5)],
      getArtist: async () => null,
      getOrFetchRelatedArtists: async () => [makeRelated(seedA, 'target-a', 'Target A', 0.8)],
      putRecommendations: async () => {},
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.sourceName, '');
  });
});
