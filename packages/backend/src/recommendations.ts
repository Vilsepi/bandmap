import type { Artist, Recommendation } from '@bandmap/shared';
import {
  RECOMMENDATION_MIN_SCORE,
  RECOMMENDATION_MAX_SEEDS,
  RECOMMENDATION_MAX_RESULTS,
} from '@bandmap/shared';
import { normalizeRecommendationSourceArtistName } from '@bandmap/shared/recommendations';
import * as db from './db.js';
import { getOrFetchArtist, getOrFetchRelatedArtists } from './cache.js';

interface RecommendationDeps {
  listRatings: typeof db.listRatings;
  getArtist: (artistId: string) => Promise<Artist | null>;
  putRecommendations: typeof db.putRecommendations;
  getOrFetchRelatedArtists: typeof getOrFetchRelatedArtists;
}

const defaultDeps: RecommendationDeps = {
  listRatings: db.listRatings,
  getArtist: getOrFetchArtist,
  putRecommendations: db.putRecommendations,
  getOrFetchRelatedArtists,
};

/**
 * Generate recommendations for a user based on their highly-rated artists.
 *
 * Algorithm:
 * 1. Get all rated ratings for the user, sorted by score descending.
 * 2. For the top N liked artists (score >= RECOMMENDATION_MIN_SCORE), fetch related artists.
 * 3. For each related artist, compute a relevance score = userScore × match.
 *    If an artist appears from multiple sources, sum the scores.
 * 4. Exclude artists the user has already rated or bookmarked.
 * 5. Sort by aggregate score, take the top RECOMMENDATION_MAX_RESULTS.
 * 6. Write to the recommendations table and return.
 */
export async function generateRecommendations(userId: string): Promise<Recommendation[]> {
  return generateRecommendationsWithDeps(userId, defaultDeps);
}

export async function generateRecommendationsWithDeps(
  userId: string,
  deps: RecommendationDeps,
): Promise<Recommendation[]> {
  // 1. Get all user ratings to know what to exclude and what to seed from
  const allRatings = await deps.listRatings(userId);

  // Set of all artist IDs the user has interacted with
  const interactedArtistIds = new Set(allRatings.map((o) => o.artistId));

  // Liked artists sorted by score descending
  const likedRatings = allRatings
    .filter((o) => o.status === 'rated' && o.score !== null && o.score >= RECOMMENDATION_MIN_SCORE)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, RECOMMENDATION_MAX_SEEDS);

  if (likedRatings.length === 0) {
    await deps.putRecommendations(userId, []);
    return [];
  }

  // 2. Fetch related artists for each liked artist
  // Track: artistId → { totalScore, artistName, bestSourceId, bestSourceName }
  const candidateMap = new Map<
    string,
    {
      totalScore: number;
      artistName: string;
      bestSourceId: string;
      bestSourceName: string;
      bestContribution: number;
    }
  >();

  // We also need artist names for the sources — fetch them in parallel
  const seedArtists = await Promise.all(
    likedRatings.map(async (rating) => {
      // Source artist names are only used for explanation copy, so keep
      // recommendation generation best-effort if that lookup fails.
      const sourceArtistPromise = deps.getArtist(rating.artistId).catch((error: unknown) => {
        const errorName = error instanceof Error ? error.name : typeof error;
        const errorStatusCode =
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          typeof error.statusCode === 'number'
            ? error.statusCode
            : undefined;
        console.warn('Recommendation source artist lookup failed', {
          userId,
          sourceId: rating.artistId,
          errorName,
          errorStatusCode,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      const [related, artist] = await Promise.all([
        deps.getOrFetchRelatedArtists(rating.artistId),
        sourceArtistPromise,
      ]);
      if (artist === null) {
        console.warn('Recommendation source artist missing after lookup', {
          userId,
          sourceId: rating.artistId,
          relatedCount: related.length,
        });
        return { rating, related, artistName: '' };
      }
      const artistName = normalizeRecommendationSourceArtistName(artist.name);
      if (artistName.length === 0) {
        console.warn('Recommendation source artist had invalid name', {
          userId,
          sourceId: rating.artistId,
          sourceName: artist.name,
          relatedCount: related.length,
        });
      }
      return { rating, related, artistName };
    }),
  );

  for (const { rating, related, artistName } of seedArtists) {
    const userScore = rating.score ?? 0;

    for (const rel of related) {
      // Skip artists the user already knows about
      if (interactedArtistIds.has(rel.targetId)) continue;

      const contribution = userScore * rel.match;
      const existing = candidateMap.get(rel.targetId);

      if (existing) {
        existing.totalScore += contribution;
        if (contribution > existing.bestContribution) {
          existing.bestSourceId = rating.artistId;
          existing.bestSourceName = artistName;
          existing.bestContribution = contribution;
        }
      } else {
        candidateMap.set(rel.targetId, {
          totalScore: contribution,
          artistName: rel.targetName,
          bestSourceId: rating.artistId,
          bestSourceName: artistName,
          bestContribution: contribution,
        });
      }
    }
  }

  // 5. Sort and take top results
  const now = Math.floor(Date.now() / 1000);
  const recommendations: Recommendation[] = [...candidateMap.entries()]
    .sort((a, b) => b[1].totalScore - a[1].totalScore)
    .slice(0, RECOMMENDATION_MAX_RESULTS)
    .map(([artistId, data]) => ({
      userId,
      artistId,
      artistName: data.artistName,
      score: Math.round(data.totalScore * 100) / 100,
      sourceId: data.bestSourceId,
      sourceName: data.bestSourceName,
      generatedAt: now,
    }));

  // 6. Write and return
  await deps.putRecommendations(userId, recommendations);
  return recommendations;
}
