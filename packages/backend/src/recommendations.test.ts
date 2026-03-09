import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Artist, Rating, RelatedArtist, Recommendation } from '@bandmap/shared';
import { generateRecommendationsWithDeps } from './recommendations.js';

const USER_ID = 'user-1';

function makeRating(artistMbid: string, score: number): Rating {
  return {
    userId: USER_ID,
    artistMbid,
    score,
    status: 'rated',
    updatedAt: new Date().toISOString(),
  };
}

function makeArtist(mbid: string, name: string): Artist {
  return {
    mbid,
    name,
    url: `https://example.com/${mbid}`,
    tags: [],
    fetchedAt: new Date().toISOString(),
  };
}

function makeRelated(
  sourceMbid: string,
  targetMbid: string,
  targetName: string,
  match: number,
): RelatedArtist {
  return {
    sourceMbid,
    targetMbid,
    targetName,
    match,
    fetchedAt: new Date().toISOString(),
  };
}

describe('generateRecommendations scoring', () => {
  it('uses rating score when comparing recommendations', async () => {
    const seedA = 'seed-a';
    const seedB = 'seed-b';

    let written: Recommendation[] = [];
    const result = await generateRecommendationsWithDeps(USER_ID, {
      listRatings: async () => [makeRating(seedA, 5), makeRating(seedB, 4)],
      getArtist: async (mbid: string) =>
        mbid === seedA ? makeArtist(seedA, 'Seed A') : makeArtist(seedB, 'Seed B'),
      getOrFetchRelatedArtists: async (mbid: string) => {
        if (mbid === seedA) {
          return [makeRelated(seedA, 'target-x', 'Target X', 0.8)];
        }
        return [makeRelated(seedB, 'target-y', 'Target Y', 0.9)];
      },
      putRecommendations: async (_userId: string, items: Recommendation[]) => {
        written = items;
      },
    });

    assert.equal(result.length, 2);
    assert.equal(result[0]?.artistMbid, 'target-x');
    assert.equal(result[0]?.score, 4);
    assert.equal(result[1]?.artistMbid, 'target-y');
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
    assert.equal(result[0]?.artistMbid, 'target-high');
    assert.equal(result[0]?.score, 4);
    assert.equal(result[1]?.artistMbid, 'target-low');
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
    assert.equal(result[0]?.sourceArtistName, '');
  });
});
