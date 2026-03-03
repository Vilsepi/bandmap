/** How long before a cached artist/relations record is considered stale (7 days) */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Minimum score (inclusive) for an artist to be considered "liked" for recommendations */
export const RECOMMENDATION_MIN_SCORE = 4;

/** Maximum number of liked artists to use as recommendation seeds */
export const RECOMMENDATION_MAX_SEEDS = 20;

/** Maximum number of recommendations to generate per user */
export const RECOMMENDATION_MAX_RESULTS = 30;
