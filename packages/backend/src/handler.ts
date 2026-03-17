import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type {
  ArtistResponse,
  AuthSessionResponse,
  RelatedArtistsResponse,
  RatingResponse,
  RatingsListResponse,
  RecommendationsResponse,
  SearchResponse,
  ErrorResponse,
  LoginRequest,
  PutRatingBody,
  RefreshSessionRequest,
} from '@bandmap/shared';
import { normalizeRecommendationSourceArtistName } from '@bandmap/shared/recommendations';
import { authenticate } from './auth.js';
import { getOrFetchArtist, getOrFetchRelatedArtists, getOrFetchSearchResults } from './cache.js';
import { loginWithUsernamePassword, refreshLoginSession } from './cognito.js';
import * as db from './db.js';
import {
  corsResponse,
  jsonResponse,
  normalizeHeaders,
  normalizeIncomingPath,
  parseBody,
} from './http.js';
import { logger } from './log.js';
import { generateRecommendations } from './recommendations.js';

// ── Route definitions ────────────────────────────────────────

interface RouteMatch {
  params: string[];
  requiresAuth: boolean;
  handle: (
    event: APIGatewayProxyEventV2,
    userId: string,
    params: string[],
  ) => Promise<APIGatewayProxyResultV2>;
}

const ARTISTS_PATTERN = /^\/artists\/([^/]+)$/;
const RELATED_PATTERN = /^\/artists\/([^/]+)\/related$/;
const RATINGS_PATTERN = /^\/ratings\/([^/]+)$/;

function matchRoute(method: string, path: string): RouteMatch | null {
  const staticRoute = matchStaticRoute(method, path);
  if (staticRoute) {
    return staticRoute;
  }

  return matchEntityRoute(method, path);
}

function matchStaticRoute(method: string, path: string): RouteMatch | null {
  if (method === 'GET' && path === '/search') {
    return { params: [], requiresAuth: false, handle: handleSearch };
  }

  if (method === 'POST' && path === '/auth/login') {
    return { params: [], requiresAuth: false, handle: handleLogin };
  }

  if (method === 'POST' && path === '/auth/refresh') {
    return { params: [], requiresAuth: false, handle: handleRefresh };
  }

  if (method === 'GET' && path === '/ratings') {
    return { params: [], requiresAuth: true, handle: handleListRatings };
  }

  if (method === 'GET' && path === '/recommendations') {
    return { params: [], requiresAuth: true, handle: handleGetRecommendations };
  }

  if (method === 'POST' && path === '/recommendations/generate') {
    return { params: [], requiresAuth: true, handle: handleGenerateRecommendations };
  }

  return null;
}

function matchEntityRoute(method: string, path: string): RouteMatch | null {
  const artistExec = ARTISTS_PATTERN.exec(path);
  if (method === 'GET' && artistExec) {
    return { params: [artistExec[1]], requiresAuth: true, handle: handleGetArtist };
  }

  const relatedExec = RELATED_PATTERN.exec(path);
  if (method === 'GET' && relatedExec) {
    return { params: [relatedExec[1]], requiresAuth: true, handle: handleGetRelatedArtists };
  }

  const ratingExec = RATINGS_PATTERN.exec(path);
  if (ratingExec) {
    if (method === 'PUT') {
      return { params: [ratingExec[1]], requiresAuth: true, handle: handlePutRating };
    }
    if (method === 'DELETE') {
      return { params: [ratingExec[1]], requiresAuth: true, handle: handleDeleteRating };
    }
  }

  return null;
}

// ── Handler ──────────────────────────────────────────────────

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const method = event.requestContext.http.method;
    const path = normalizeIncomingPath(event);

    logger.debug(
      {
        rawPath: event.rawPath,
        stage: event.requestContext.stage,
        queryStringParameters: event.queryStringParameters,
      },
      `${method} ${path}`,
    );

    // Handle CORS preflight requests
    if (method === 'OPTIONS') {
      return corsResponse();
    }

    const route = matchRoute(method, path);

    if (!route) {
      return jsonResponse<ErrorResponse>(404, { error: 'Not found' });
    }

    let userId = '';
    if (route.requiresAuth) {
      const headers = normalizeHeaders(event.headers);
      const authContext = await authenticate(headers);
      if (!authContext) {
        return jsonResponse<ErrorResponse>(401, { error: 'Invalid or missing session token' });
      }
      userId = authContext.userId;
    }

    return await route.handle(event, userId, route.params);
  } catch (err) {
    console.error('Unhandled error:', err);
    return jsonResponse<ErrorResponse>(500, { error: 'Internal server error' });
  }
}

// ── Route handlers ───────────────────────────────────────────

async function handleSearch(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const q = event.queryStringParameters?.['q'];
  if (!q || q.trim().length === 0) {
    return jsonResponse<ErrorResponse>(400, { error: 'Query parameter "q" is required' });
  }

  const results = await getOrFetchSearchResults(q);

  return jsonResponse<SearchResponse>(200, { results });
}

async function handleLogin(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = parseBody<LoginRequest>(event.body);
  if (!body?.username || !body.password) {
    return jsonResponse<ErrorResponse>(400, { error: 'Username and password are required' });
  }

  try {
    const session = await loginWithUsernamePassword(body.username.trim(), body.password);
    return jsonResponse<AuthSessionResponse>(200, session);
  } catch (error) {
    console.error('Login failed', error);
    return jsonResponse<ErrorResponse>(401, { error: 'Invalid username or password' });
  }
}

async function handleRefresh(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = parseBody<RefreshSessionRequest>(event.body);
  if (!body?.refreshToken) {
    return jsonResponse<ErrorResponse>(400, { error: 'Refresh token is required' });
  }

  try {
    const session = await refreshLoginSession(body.refreshToken);
    return jsonResponse<AuthSessionResponse>(200, session);
  } catch (error) {
    console.error('Session refresh failed', error);
    return jsonResponse<ErrorResponse>(401, { error: 'Invalid refresh token' });
  }
}

async function handleGetArtist(
  _event: APIGatewayProxyEventV2,
  _userId: string,
  params: string[],
): Promise<APIGatewayProxyResultV2> {
  const artist = await getOrFetchArtist(params[0]);
  return jsonResponse<ArtistResponse>(200, { artist });
}

async function handleGetRelatedArtists(
  _event: APIGatewayProxyEventV2,
  _userId: string,
  params: string[],
): Promise<APIGatewayProxyResultV2> {
  const artistId = params[0];
  const related = await getOrFetchRelatedArtists(artistId);
  return jsonResponse<RelatedArtistsResponse>(200, { sourceId: artistId, related });
}

async function handleListRatings(
  event: APIGatewayProxyEventV2,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const statusParam = event.queryStringParameters?.['status'];
  const status = statusParam === 'rated' || statusParam === 'todo' ? statusParam : undefined;
  const ratings = await db.listRatings(userId, status);
  return jsonResponse<RatingsListResponse>(200, { ratings });
}

async function handlePutRating(
  event: APIGatewayProxyEventV2,
  userId: string,
  params: string[],
): Promise<APIGatewayProxyResultV2> {
  const artistId = params[0];
  const body = parseBody<PutRatingBody>(event.body);
  if (!body) {
    return jsonResponse<ErrorResponse>(400, { error: 'Invalid request body' });
  }

  if (typeof body.todo !== 'boolean') {
    return jsonResponse<ErrorResponse>(400, { error: '"todo" must be a boolean' });
  }

  if (body.score !== null) {
    if (typeof body.score !== 'number' || body.score < 1 || body.score > 5) {
      return jsonResponse<ErrorResponse>(400, {
        error: 'Score must be null or a number between 1 and 5',
      });
    }
  }

  // When both score and todo are cleared the item carries no information — delete it
  if (body.score === null && !body.todo) {
    await db.deleteRating(userId, artistId);
    return jsonResponse(204, null);
  }

  const rating = {
    userId,
    artistId,
    score: body.score,
    todo: body.todo,
    updatedAt: Math.floor(Date.now() / 1000),
  };

  await db.putRating(rating);
  return jsonResponse<RatingResponse>(200, { rating });
}

async function handleDeleteRating(
  _event: APIGatewayProxyEventV2,
  userId: string,
  params: string[],
): Promise<APIGatewayProxyResultV2> {
  await db.deleteRating(userId, params[0]);
  return jsonResponse(204, null);
}

function logRecommendationsWithInvalidSourceNames(
  logMessage: string,
  userId: string,
  recommendations: RecommendationsResponse['recommendations'],
): void {
  const recommendationsWithMissingSourceName = recommendations.filter(
    (recommendation) =>
      normalizeRecommendationSourceArtistName(recommendation.sourceName).length === 0,
  );
  if (recommendationsWithMissingSourceName.length === 0) {
    return;
  }

  console.warn(logMessage, {
    userId,
    count: recommendationsWithMissingSourceName.length,
    recommendationArtistIds: recommendationsWithMissingSourceName.map(
      (recommendation) => recommendation.artistId,
    ),
    sourceArtistIds: recommendationsWithMissingSourceName.map(
      (recommendation) => recommendation.sourceId,
    ),
  });
}

async function handleGetRecommendations(
  _event: APIGatewayProxyEventV2,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const recommendations = await db.listRecommendations(userId);
  logRecommendationsWithInvalidSourceNames(
    'Recommendations with missing source artist names loaded',
    userId,
    recommendations,
  );
  return jsonResponse<RecommendationsResponse>(200, { recommendations });
}

async function handleGenerateRecommendations(
  _event: APIGatewayProxyEventV2,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const recommendations = await generateRecommendations(userId);
  logRecommendationsWithInvalidSourceNames(
    'Generated recommendations with missing source artist names',
    userId,
    recommendations,
  );
  return jsonResponse<RecommendationsResponse>(200, { recommendations });
}
