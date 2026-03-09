import { CognitoJwtVerifier } from 'aws-jwt-verify';
import * as db from './db.js';

export interface AuthContext {
  userId: string;
  username: string;
  cognitoSub: string;
  groups: string[];
}

type BandmapTokenPayload = {
  sub: string;
  'custom:app_user_id'?: string;
  'cognito:username'?: string;
  'cognito:groups'?: string[];
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier(): ReturnType<typeof CognitoJwtVerifier.create> {
  verifier ??= CognitoJwtVerifier.create({
    userPoolId: env('COGNITO_USER_POOL_ID'),
    clientId: env('COGNITO_CLIENT_ID'),
    tokenUse: 'id',
  });
  return verifier;
}

function extractBearerToken(headers: Record<string, string | undefined>): string | null {
  const header = headers['authorization'];
  if (!header) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/.exec(header);
  return match?.[1] ?? null;
}

function groupsFromPayload(payload: BandmapTokenPayload): string[] {
  const groups = payload['cognito:groups'];
  return Array.isArray(groups) ? groups : [];
}

export async function verifySessionToken(token: string): Promise<AuthContext | null> {
  const payload = (await getVerifier().verify(token)) as BandmapTokenPayload;
  const cognitoSub = payload.sub;
  const username = payload['cognito:username'];
  const claimUserId = payload['custom:app_user_id'];

  if (!cognitoSub || !username) {
    return null;
  }

  if (claimUserId) {
    return {
      userId: claimUserId,
      username,
      cognitoSub,
      groups: groupsFromPayload(payload),
    };
  }

  const user = await db.getUserByCognitoSub(cognitoSub);
  if (!user) {
    return null;
  }

  return {
    userId: user.id,
    username: user.username,
    cognitoSub,
    groups: groupsFromPayload(payload),
  };
}

export async function authenticate(
  headers: Record<string, string | undefined>,
): Promise<AuthContext | null> {
  const token = extractBearerToken(headers);
  if (!token) {
    return null;
  }

  try {
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}

export function isAdmin(context: AuthContext): boolean {
  return context.groups.includes('admin');
}
