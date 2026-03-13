import { randomBytes, randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type {
  CreateInvitesRequest,
  CreateInvitesResponse,
  ErrorResponse,
  Invite,
  RedeemInviteRequest,
  RedeemInviteResponse,
  User,
  ValidateInviteResponse,
} from '@bandmap/shared';
import { authenticate, isAdmin } from './auth.js';
import { assertUsernameAvailable, createInvitedUser, deleteCognitoUser } from './cognito.js';
import * as db from './db.js';
import {
  corsResponse,
  jsonResponse,
  normalizeHeaders,
  normalizeIncomingPath,
  parseBody,
} from './http.js';

const INVITE_VALIDITY_DAYS = 30;
const INVITE_MAX_USES = 10;
const MAX_INVITES_PER_REQUEST = 50;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const method = event.requestContext.http.method;
    const path = normalizeIncomingPath(event);

    if (method === 'OPTIONS') {
      return corsResponse();
    }

    if (method === 'POST' && path === '/invites') {
      return handleCreateInvites(event);
    }

    if (method === 'GET' && path === '/invites/validate') {
      return handleValidateInvite(event);
    }

    if (method === 'POST' && path === '/invites/redeem') {
      return handleRedeemInvite(event);
    }

    return jsonResponse<ErrorResponse>(404, { error: 'Not found' });
  } catch (error) {
    console.error('Unhandled invite handler error', error);
    return jsonResponse<ErrorResponse>(500, { error: 'Internal server error' });
  }
}

async function handleCreateInvites(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const authContext = await authenticate(normalizeHeaders(event.headers));
  if (!authContext) {
    return jsonResponse<ErrorResponse>(401, { error: 'Invalid or missing session token' });
  }

  if (!isAdmin(authContext)) {
    return jsonResponse<ErrorResponse>(403, { error: 'Admin access is required' });
  }

  const body = parseBody<CreateInvitesRequest>(event.body) ?? {};
  const requestedCount = body.count ?? 1;
  if (
    !Number.isInteger(requestedCount) ||
    requestedCount < 1 ||
    requestedCount > MAX_INVITES_PER_REQUEST
  ) {
    return jsonResponse<ErrorResponse>(400, {
      error: `Count must be an integer between 1 and ${MAX_INVITES_PER_REQUEST}`,
    });
  }

  const invites: CreateInvitesResponse['invites'] = [];
  for (let index = 0; index < requestedCount; index += 1) {
    const invite = buildInvite(authContext.userId);
    await db.putInvite(invite);
    invites.push({
      code: invite.code,
      inviteUrl: buildInviteUrl(invite.code),
      expiresAt: invite.expiresAt,
      remainingUses: invite.maxUses - invite.usedCount,
    });
  }

  return jsonResponse<CreateInvitesResponse>(201, { invites });
}

async function handleValidateInvite(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const code = event.queryStringParameters?.['code']?.trim() ?? '';
  if (!code) {
    return jsonResponse<ErrorResponse>(400, { error: 'Invite code is required' });
  }

  const invite = await db.getInvite(code);
  return jsonResponse<ValidateInviteResponse>(200, {
    invite: toInviteValidation(invite),
  });
}

async function handleRedeemInvite(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = parseBody<RedeemInviteRequest>(event.body);
  if (!body?.code || !body.username || !body.password) {
    return jsonResponse<ErrorResponse>(400, {
      error: 'Invite code, username, and password are required',
    });
  }

  const username = body.username.trim();
  if (!USERNAME_PATTERN.test(username)) {
    return jsonResponse<ErrorResponse>(400, {
      error:
        'Username must be 3-32 characters using letters, numbers, dots, underscores, or hyphens',
    });
  }

  if (body.password.length < 12) {
    return jsonResponse<ErrorResponse>(400, {
      error: 'Password must be at least 12 characters long',
    });
  }

  const invite = await db.getInvite(body.code);
  const inviteValidation = toInviteValidation(invite);
  if (!inviteValidation.isValid) {
    return jsonResponse<ErrorResponse>(400, {
      error: 'Invite code is invalid, expired, or exhausted',
    });
  }

  const existingUser = await db.getUserByUsername(username);
  if (existingUser) {
    return jsonResponse<ErrorResponse>(409, { error: 'Username already exists' });
  }

  try {
    await assertUsernameAvailable(username);
  } catch (error) {
    console.error('Username validation failed', error);
    return jsonResponse<ErrorResponse>(409, { error: 'Username already exists' });
  }

  const userId = randomUUID();
  const cognitoUsername: string | null = username;

  try {
    const cognitoUser = await createInvitedUser({
      userId,
      username,
      password: body.password,
    });

    const user: User = {
      id: userId,
      username,
      cognitoSub: cognitoUser.cognitoSub,
      createdAt: nowEpochSeconds(),
    };

    await db.redeemInvite(body.code, user, nowEpochSeconds());
    return jsonResponse<RedeemInviteResponse>(201, { user });
  } catch (error) {
    console.error('Invite redemption failed', error);

    if (cognitoUsername) {
      try {
        await deleteCognitoUser(cognitoUsername);
      } catch (deleteError) {
        console.error('Failed to roll back Cognito user creation', deleteError);
      }
    }

    const message =
      isConditionalCheckFailure(error) || isUsernameExistsError(error)
        ? 'Invite code is invalid, expired, exhausted, or the username already exists'
        : 'Unable to redeem invite';
    const statusCode = isConditionalCheckFailure(error) || isUsernameExistsError(error) ? 409 : 500;

    return jsonResponse<ErrorResponse>(statusCode, { error: message });
  }
}

function buildInvite(createdBy: string): Invite {
  const now = nowEpochSeconds();
  const expiresAt = now + INVITE_VALIDITY_DAYS * 24 * 60 * 60;
  return {
    code: generateInviteCode(),
    createdBy,
    createdAt: now,
    expiresAt,
    maxUses: INVITE_MAX_USES,
    usedCount: 0,
  };
}

function buildInviteUrl(code: string): string {
  const baseUrl = (process.env['FRONTEND_BASE_URL'] ?? '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('Missing environment variable: FRONTEND_BASE_URL');
  }
  return `${baseUrl}/#invite?code=${encodeURIComponent(code)}`;
}

function generateInviteCode(): string {
  return randomBytes(30).toString('base64url').toUpperCase();
}

function toInviteValidation(invite: Invite | null): ValidateInviteResponse['invite'] {
  if (!invite) {
    return {
      code: '',
      expiresAt: 0,
      remainingUses: 0,
      isValid: false,
    };
  }

  const remainingUses = Math.max(invite.maxUses - invite.usedCount, 0);
  return {
    code: invite.code,
    expiresAt: invite.expiresAt,
    remainingUses,
    isValid: invite.expiresAt > nowEpochSeconds() && remainingUses > 0,
  };
}

function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'ConditionalCheckFailedException'
  );
}

function isUsernameExistsError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'UsernameExistsException'
  );
}
