import type { Recommendation } from '@bandmap/shared';
import {
  RECOMMENDATION_MIN_SCORE,
  RECOMMENDATION_MAX_SEEDS,
  RECOMMENDATION_MAX_RESULTS,
} from '@bandmap/shared';
import * as db from './db.js';
import { getOrFetchRelatedArtists } from './cache.js';

interface RecommendationDeps {
  listRatings: typeof db.listRatings;
  getArtist: typeof db.getArtist;
  putRecommendations: typeof db.putRecommendations;
  getOrFetchRelatedArtists: typeof getOrFetchRelatedArtists;
}

const defaultDeps: RecommendationDeps = {
  listRatings: db.listRatings,
  getArtist: db.getArtist,
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

  // Set of all artist mbids the user has interacted with
  const interactedMbids = new Set(allRatings.map((o) => o.artistMbid));

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
  // Track: artistMbid → { totalScore, artistName, bestSourceMbid, bestSourceName }
  const candidateMap = new Map<
    string,
    {
      totalScore: number;
      artistName: string;
      bestSourceMbid: string;
      bestSourceName: string;
      bestContribution: number;
    }
  >();

  // We also need artist names for the sources — fetch them in parallel
  const seedArtists = await Promise.all(
    likedRatings.map(async (rating) => {
      const [related, artist] = await Promise.all([
        deps.getOrFetchRelatedArtists(rating.artistMbid),
        deps.getArtist(rating.artistMbid),
      ]);
      return { rating, related, artistName: artist?.name ?? 'Unknown' };
    }),
  );

  for (const { rating, related, artistName } of seedArtists) {
    const userScore = rating.score ?? 0;

    for (const rel of related) {
      // Skip artists the user already knows about
      if (interactedMbids.has(rel.targetMbid)) continue;

      const contribution = userScore * rel.match;
      const existing = candidateMap.get(rel.targetMbid);

      if (existing) {
        existing.totalScore += contribution;
        if (contribution > existing.bestContribution) {
          existing.bestSourceMbid = rating.artistMbid;
          existing.bestSourceName = artistName;
          existing.bestContribution = contribution;
        }
      } else {
        candidateMap.set(rel.targetMbid, {
          totalScore: contribution,
          artistName: rel.targetName,
          bestSourceMbid: rating.artistMbid,
          bestSourceName: artistName,
          bestContribution: contribution,
        });
      }
    }
  }

  // 5. Sort and take top results
  const now = new Date().toISOString();
  const recommendations: Recommendation[] = [...candidateMap.entries()]
    .sort((a, b) => b[1].totalScore - a[1].totalScore)
    .slice(0, RECOMMENDATION_MAX_RESULTS)
    .map(([artistMbid, data]) => ({
      userId,
      artistMbid,
      artistName: data.artistName,
      score: Math.round(data.totalScore * 100) / 100,
      sourceArtistMbid: data.bestSourceMbid,
      sourceArtistName: data.bestSourceName,
      generatedAt: now,
    }));

  // 6. Write and return
  await deps.putRecommendations(userId, recommendations);
  return recommendations;
}
