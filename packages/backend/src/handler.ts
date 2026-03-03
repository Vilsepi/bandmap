import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type {
  ArtistResponse,
  RelatedArtistsResponse,
  RatingResponse,
  RatingsListResponse,
  RecommendationsResponse,
  SearchResponse,
  ErrorResponse,
  PutRatingBody,
} from '@bandmap/shared';
import { authenticate } from './auth.js';
import { getOrFetchArtist, getOrFetchRelatedArtists, getOrFetchSearchResults } from './cache.js';
import * as db from './db.js';
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
      return {
        statusCode: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
          'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
        body: '',
      };
    }

    const route = matchRoute(method, path);

    if (!route) {
      return jsonResponse<ErrorResponse>(404, { error: 'Not found' });
    }

    let userId = '';
    if (route.requiresAuth) {
      const headers = normalizeHeaders(event.headers);
      const user = await authenticate(headers);
      if (!user) {
        return jsonResponse<ErrorResponse>(401, { error: 'Invalid or missing API key' });
      }
      userId = user.id;
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

async function handleGetRecommendations(
  _event: APIGatewayProxyEventV2,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const recommendations = await db.listRecommendations(userId);
  return jsonResponse<RecommendationsResponse>(200, { recommendations });
}

async function handleGenerateRecommendations(
  _event: APIGatewayProxyEventV2,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const recommendations = await generateRecommendations(userId);
  return jsonResponse<RecommendationsResponse>(200, { recommendations });
}

// ── Helpers ──────────────────────────────────────────────────

function jsonResponse<T>(statusCode: number, body: T): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    },
    body: body === null ? '' : JSON.stringify(body),
  };
}

function normalizeHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function parseBody<T>(body: string | undefined): T | null {
  if (!body) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function getLastFmApiKey(): string {
  const key = process.env['LASTFM_API_KEY'];
  if (!key) {
    throw new Error('Missing environment variable: LASTFM_API_KEY');
  }
  return key;
}

function normalizeIncomingPath(event: APIGatewayProxyEventV2): string {
  const rawPath = event.rawPath || '/';
  const stage = event.requestContext.stage;

  if (!stage || stage === '$default') {
    return rawPath;
  }

  const stagePrefix = `/${stage}`;
  if (rawPath === stagePrefix) {
    return '/';
  }

  if (rawPath.startsWith(`${stagePrefix}/`)) {
    return rawPath.slice(stagePrefix.length);
  }

  return rawPath;
}
