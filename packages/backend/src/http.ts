import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const ALLOW_HEADERS = 'Content-Type, Authorization';
const ALLOW_METHODS = 'GET, PUT, POST, DELETE, OPTIONS';

export function jsonResponse<T>(statusCode: number, body: T): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': ALLOW_HEADERS,
      'Access-Control-Allow-Methods': ALLOW_METHODS,
    },
    body: body === null ? '' : JSON.stringify(body),
  };
}

export function corsResponse(): APIGatewayProxyResultV2 {
  return {
    statusCode: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': ALLOW_HEADERS,
      'Access-Control-Allow-Methods': ALLOW_METHODS,
      'Access-Control-Max-Age': '86400',
    },
    body: '',
  };
}

export function normalizeHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

export function parseBody<T>(body: string | undefined): T | null {
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

export function normalizeIncomingPath(event: APIGatewayProxyEventV2): string {
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
