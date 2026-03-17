import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { AuthSessionResponse } from '@bandmap/shared';

let formatCurrentUserStatus: (user: AuthSessionResponse['user'] | null) => string | null;

before(async () => {
  Object.assign(globalThis, {
    document: {
      getElementById: () => null,
      querySelector: () => null,
      body: {
        classList: {
          toggle: () => undefined,
        },
      },
    },
  });

  ({ formatCurrentUserStatus } = await import('../settings-menu.js'));
});

describe('formatCurrentUserStatus', () => {
  it('returns null when no user is available', () => {
    assert.equal(formatCurrentUserStatus(null), null);
  });

  it('includes the username and admin state for admin users', () => {
    const user: AuthSessionResponse['user'] = {
      id: 'user-1',
      username: 'tester',
      isAdmin: true,
      cognitoSub: 'sub-1',
      createdAt: 1735862400,
    };

    assert.equal(formatCurrentUserStatus(user), 'Signed in as tester (Admin role)');
  });

  it('includes the username and admin state for non-admin users', () => {
    const user: AuthSessionResponse['user'] = {
      id: 'user-1',
      username: 'tester',
      isAdmin: false,
      cognitoSub: 'sub-1',
      createdAt: 1735862400,
    };

    assert.equal(formatCurrentUserStatus(user), 'Signed in as tester');
  });
});
