import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type {
  ArtistResponse,
  RelatedArtistsResponse,
  OpinionResponse,
  OpinionsListResponse,
  RecommendationsResponse,
  SearchResponse,
  ErrorResponse,
  PutOpinionBody,
} from '@bandmap/shared';
import { authenticate } from './auth.js';
import { getOrFetchArtist, getOrFetchRelatedArtists } from './cache.js';
import * as db from './db.js';
import { searchArtists } from './lastfm.js';
import { generateRecommendations } from './recommendations.js';

// ── Route definitions ────────────────────────────────────────

interface RouteMatch {
  params: string[];
  requiresAuth: boolean;
  handle: (
    event: APIGatewayProxyEventV2,
    apiKey: string,
    params: string[],
  ) => Promise<APIGatewayProxyResultV2>;
}

const ARTISTS_PATTERN = /^\/artists\/([^/]+)$/;
const RELATED_PATTERN = /^\/artists\/([^/]+)\/related$/;
const OPINIONS_MBID_PATTERN = /^\/opinions\/([^/]+)$/;

function matchRoute(method: string, path: string): RouteMatch | null {
  if (method === 'GET' && path === '/search') {
    return { params: [], requiresAuth: false, handle: handleSearch };
  }

  if (method === 'GET' && path === '/opinions') {
    return { params: [], requiresAuth: true, handle: handleListOpinions };
  }

  if (method === 'GET' && path === '/recommendations') {
    return { params: [], requiresAuth: true, handle: handleGetRecommendations };
  }

  if (method === 'POST' && path === '/recommendations/generate') {
    return { params: [], requiresAuth: true, handle: handleGenerateRecommendations };
  }

  const artistExec = ARTISTS_PATTERN.exec(path);
  if (method === 'GET' && artistExec) {
    return { params: [artistExec[1]], requiresAuth: true, handle: handleGetArtist };
  }

  const relatedExec = RELATED_PATTERN.exec(path);
  if (method === 'GET' && relatedExec) {
    return { params: [relatedExec[1]], requiresAuth: true, handle: handleGetRelatedArtists };
  }

  const opinionExec = OPINIONS_MBID_PATTERN.exec(path);
  if (opinionExec) {
    if (method === 'PUT') {
      return { params: [opinionExec[1]], requiresAuth: true, handle: handlePutOpinion };
    }
    if (method === 'DELETE') {
      return { params: [opinionExec[1]], requiresAuth: true, handle: handleDeleteOpinion };
    }
  }

  return null;
}

// ── Handler ──────────────────────────────────────────────────

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const method = event.requestContext.http.method;
    const route = matchRoute(method, event.rawPath);

    if (!route) {
      return jsonResponse<ErrorResponse>(404, { error: 'Not found' });
    }

    let apiKey = '';
    if (route.requiresAuth) {
      const headers = normalizeHeaders(event.headers);
      const user = await authenticate(headers);
      if (!user) {
        return jsonResponse<ErrorResponse>(401, { error: 'Invalid or missing API key' });
      }
      apiKey = user.apiKey;
    }

    return await route.handle(event, apiKey, route.params);
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
  const results = await searchArtists(q, apiKey);

  return jsonResponse<SearchResponse>(200, { results });
}

async function handleGetArtist(
  _event: APIGatewayProxyEventV2,
  _apiKey: string,
  params: string[],
): Promise<APIGatewayProxyResultV2> {
  const artist = await getOrFetchArtist(params[0]);
  return jsonResponse<ArtistResponse>(200, { artist });
}

async function handleGetRelatedArtists(
  _event: APIGatewayProxyEventV2,
  _apiKey: string,
  params: string[],
): Promise<APIGatewayProxyResultV2> {
  const mbid = params[0];
  const related = await getOrFetchRelatedArtists(mbid);
  return jsonResponse<RelatedArtistsResponse>(200, { sourceMbid: mbid, related });
}

async function handleListOpinions(
  event: APIGatewayProxyEventV2,
  apiKey: string,
): Promise<APIGatewayProxyResultV2> {
  const statusParam = event.queryStringParameters?.['status'];
  const status = statusParam === 'rated' || statusParam === 'todo' ? statusParam : undefined;
  const opinions = await db.listOpinions(apiKey, status);
  return jsonResponse<OpinionsListResponse>(200, { opinions });
}

async function handlePutOpinion(
  event: APIGatewayProxyEventV2,
  apiKey: string,
  params: string[],
): Promise<APIGatewayProxyResultV2> {
  const artistMbid = params[0];
  const body = parseBody<PutOpinionBody>(event.body);
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

  const opinion = {
    apiKey,
    artistMbid,
    score: body.status === 'rated' ? body.score : null,
    status: body.status,
    updatedAt: new Date().toISOString(),
  };

  await db.putOpinion(opinion);
  return jsonResponse<OpinionResponse>(200, { opinion });
}

async function handleDeleteOpinion(
  _event: APIGatewayProxyEventV2,
  apiKey: string,
  params: string[],
): Promise<APIGatewayProxyResultV2> {
  await db.deleteOpinion(apiKey, params[0]);
  return jsonResponse(204, null);
}

async function handleGetRecommendations(
  _event: APIGatewayProxyEventV2,
  apiKey: string,
): Promise<APIGatewayProxyResultV2> {
  const recommendations = await db.listRecommendations(apiKey);
  return jsonResponse<RecommendationsResponse>(200, { recommendations });
}

async function handleGenerateRecommendations(
  _event: APIGatewayProxyEventV2,
  apiKey: string,
): Promise<APIGatewayProxyResultV2> {
  const recommendations = await generateRecommendations(apiKey);
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
