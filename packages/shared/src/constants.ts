/** How long before a cached artist/relations record is considered stale (14 days) */
export const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** How long before a cached search result is considered stale (7 days) */
export const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum concurrent outgoing requests to the Last.fm API per Lambda instance */
export const LASTFM_MAX_CONCURRENT = 2;

/** Maximum number of retry attempts for retryable Last.fm API errors */
export const LASTFM_MAX_RETRIES = 2;

/** Base delay in ms for exponential backoff on Last.fm retries */
export const LASTFM_RETRY_BASE_MS = 300;

/** Minimum score (inclusive) for an artist to be considered "liked" for recommendations */
export const RECOMMENDATION_MIN_SCORE = 4;

/** Maximum number of liked artists to use as recommendation seeds */
export const RECOMMENDATION_MAX_SEEDS = 20;

/** Maximum number of recommendations to generate per user */
export const RECOMMENDATION_MAX_RESULTS = 15;
