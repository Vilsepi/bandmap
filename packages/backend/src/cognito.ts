import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  type AuthenticationResultType,
} from '@aws-sdk/client-cognito-identity-provider';
import type { AuthSessionResponse, User } from '@bandmap/shared';
import * as db from './db.js';
import { verifySessionToken } from './auth.js';

const client = new CognitoIdentityProviderClient({});

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function getAuthResult(authenticationResult: AuthenticationResultType | undefined): {
  sessionToken: string;
  refreshToken?: string;
  expiresIn: number;
} {
  const sessionToken = authenticationResult?.IdToken;
  const expiresIn = authenticationResult?.ExpiresIn;
  if (!sessionToken || typeof expiresIn !== 'number') {
    throw new Error('Cognito did not return a valid session');
  }

  return {
    sessionToken,
    refreshToken: authenticationResult?.RefreshToken,
    expiresIn,
  };
}

async function userFromSessionToken(sessionToken: string): Promise<{
  authContext: NonNullable<Awaited<ReturnType<typeof verifySessionToken>>>;
  user: User;
}> {
  const authContext = await verifySessionToken(sessionToken);
  if (!authContext) {
    throw new Error('Unable to verify Cognito session token');
  }

  const user = await db.getUserById(authContext.userId);
  if (!user) {
    throw new Error('Authenticated user was not found');
  }

  return { authContext, user };
}

function withAdminFlag(user: User, isAdmin: boolean): User {
  return {
    ...user,
    isAdmin,
  };
}

export async function isCognitoUserAdmin(username: string): Promise<boolean> {
  const response = await client.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: env('COGNITO_USER_POOL_ID'),
      Username: username,
    }),
  );

  return response.Groups?.some((group) => group.GroupName?.toLowerCase() === 'admin') ?? false;
}

export async function loginWithUsernamePassword(
  username: string,
  password: string,
): Promise<AuthSessionResponse> {
  const response = await client.send(
    new InitiateAuthCommand({
      ClientId: env('COGNITO_CLIENT_ID'),
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    }),
  );

  const session = getAuthResult(response.AuthenticationResult);
  const { authContext, user } = await userFromSessionToken(session.sessionToken);
  const isAdmin = await isCognitoUserAdmin(authContext.username);

  return {
    user: withAdminFlag(user, isAdmin),
    session: {
      sessionToken: session.sessionToken,
      refreshToken: session.refreshToken ?? '',
      expiresIn: session.expiresIn,
    },
  };
}

export async function refreshLoginSession(refreshToken: string): Promise<AuthSessionResponse> {
  const response = await client.send(
    new InitiateAuthCommand({
      ClientId: env('COGNITO_CLIENT_ID'),
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    }),
  );

  const session = getAuthResult(response.AuthenticationResult);
  const { authContext, user } = await userFromSessionToken(session.sessionToken);
  const isAdmin = await isCognitoUserAdmin(authContext.username);

  return {
    user: withAdminFlag(user, isAdmin),
    session: {
      sessionToken: session.sessionToken,
      refreshToken,
      expiresIn: session.expiresIn,
    },
  };
}

export async function assertUsernameAvailable(username: string): Promise<void> {
  try {
    await client.send(
      new AdminGetUserCommand({
        UserPoolId: env('COGNITO_USER_POOL_ID'),
        Username: username,
      }),
    );
    throw new Error('Username already exists');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      error.name === 'UserNotFoundException'
    ) {
      return;
    }

    throw error;
  }
}

export async function createInvitedUser(input: {
  userId: string;
  username: string;
  password: string;
}): Promise<{ cognitoSub: string }> {
  const userPoolId = env('COGNITO_USER_POOL_ID');

  await client.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: input.username,
      TemporaryPassword: input.password,
      MessageAction: 'SUPPRESS',
      UserAttributes: [{ Name: 'custom:app_user_id', Value: input.userId }],
    }),
  );

  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: input.username,
      Password: input.password,
      Permanent: true,
    }),
  );

  const user = await client.send(
    new AdminGetUserCommand({
      UserPoolId: userPoolId,
      Username: input.username,
    }),
  );

  const cognitoSub = user.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value;
  if (!cognitoSub) {
    throw new Error('Cognito user did not expose a subject');
  }

  return { cognitoSub };
}

export async function deleteCognitoUser(username: string): Promise<void> {
  await client.send(
    new AdminDeleteUserCommand({
      UserPoolId: env('COGNITO_USER_POOL_ID'),
      Username: username,
    }),
  );
}
