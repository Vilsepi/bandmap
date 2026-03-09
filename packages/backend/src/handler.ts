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
const RATINGS_MBID_PATTERN = /^\/ratings\/([^/]+)$/;

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

  const ratingExec = RATINGS_MBID_PATTERN.exec(path);
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

    console.log(`${method} ${path}`, {
      rawPath: event.rawPath,
      stage: event.requestContext.stage,
      queryStringParameters: event.queryStringParameters,
    });

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

  const apiKey = getLastFmApiKey();
  const results = await getOrFetchSearchResults(q, apiKey);

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
  const mbid = params[0];
  const related = await getOrFetchRelatedArtists(mbid);
  return jsonResponse<RelatedArtistsResponse>(200, { sourceMbid: mbid, related });
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
  const artistMbid = params[0];
  const body = parseBody<PutRatingBody>(event.body);
  if (!body) {
    return jsonResponse<ErrorResponse>(400, { error: 'Invalid request body' });
  }

  if (body.status !== 'rated' && body.status !== 'todo') {
    return jsonResponse<ErrorResponse>(400, { error: 'Status must be "rated" or "todo"' });
  }

  if (body.status === 'rated') {
    if (typeof body.score !== 'number' || body.score < 1 || body.score > 5) {
      return jsonResponse<ErrorResponse>(400, {
        error: 'Score must be a number between 1 and 5 when status is "rated"',
      });
    }
  }

  const rating = {
    userId,
    artistMbid,
    score: body.status === 'rated' ? body.score : null,
    status: body.status,
    updatedAt: new Date().toISOString(),
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

function hasInvalidSourceArtistName(sourceArtistName: string): boolean {
  const normalizedSourceArtistName = sourceArtistName.trim();
  return (
    normalizedSourceArtistName.length === 0 ||
    normalizedSourceArtistName.toLowerCase() === 'unknown'
  );
}

async function handleGetRecommendations(
  _event: APIGatewayProxyEventV2,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const recommendations = await db.listRecommendations(userId);
  const recommendationsWithMissingSourceName = recommendations.filter((recommendation) =>
    hasInvalidSourceArtistName(recommendation.sourceArtistName),
  );
  if (recommendationsWithMissingSourceName.length > 0) {
    console.warn('Recommendations with missing source artist names loaded', {
      userId,
      count: recommendationsWithMissingSourceName.length,
      recommendationArtistMbids: recommendationsWithMissingSourceName.map(
        (recommendation) => recommendation.artistMbid,
      ),
      sourceArtistMbids: recommendationsWithMissingSourceName.map(
        (recommendation) => recommendation.sourceArtistMbid,
      ),
    });
  }
  return jsonResponse<RecommendationsResponse>(200, { recommendations });
}

async function handleGenerateRecommendations(
  _event: APIGatewayProxyEventV2,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const recommendations = await generateRecommendations(userId);
  const recommendationsWithMissingSourceName = recommendations.filter((recommendation) =>
    hasInvalidSourceArtistName(recommendation.sourceArtistName),
  );
  if (recommendationsWithMissingSourceName.length > 0) {
    console.warn('Generated recommendations with missing source artist names', {
      userId,
      count: recommendationsWithMissingSourceName.length,
      recommendationArtistMbids: recommendationsWithMissingSourceName.map(
        (recommendation) => recommendation.artistMbid,
      ),
      sourceArtistMbids: recommendationsWithMissingSourceName.map(
        (recommendation) => recommendation.sourceArtistMbid,
      ),
    });
  }
  return jsonResponse<RecommendationsResponse>(200, { recommendations });
}

function getLastFmApiKey(): string {
  const key = process.env['LASTFM_API_KEY'];
  if (!key) {
    throw new Error('Missing environment variable: LASTFM_API_KEY');
  }
  return key;
}
