import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Invite } from '@bandmap/shared';
import { chooseLatestInvite } from './invite-handler.js';

function makeInvite(overrides: Partial<Invite>): Invite {
  return {
    code: 'invite-default',
    createdBy: 'admin-1',
    createdAt: 1_700_000_000,
    expiresAt: 1_800_000_000,
    maxUses: 10,
    usedCount: 0,
    ...overrides,
  };
}

describe('chooseLatestInvite', () => {
  it('returns null when no invite is still usable', () => {
    const invite = makeInvite({ code: 'expired', expiresAt: 1_699_999_999, usedCount: 10 });

    assert.equal(chooseLatestInvite([invite], 1_700_000_000), null);
  });

  it('prefers the invite with the most remaining uses', () => {
    const olderHighCapacity = makeInvite({
      code: 'older-high',
      createdAt: 1_700_000_010,
      usedCount: 1,
    });
    const newerLowerCapacity = makeInvite({
      code: 'newer-low',
      createdAt: 1_700_000_020,
      maxUses: 5,
      usedCount: 1,
    });

    assert.equal(
      chooseLatestInvite([newerLowerCapacity, olderHighCapacity], 1_700_000_000)?.code,
      'older-high',
    );
  });

  it('uses the newest invite when remaining uses are tied', () => {
    const olderInvite = makeInvite({ code: 'older', createdAt: 1_700_000_010, usedCount: 2 });
    const newerInvite = makeInvite({ code: 'newer', createdAt: 1_700_000_020, usedCount: 2 });

    assert.equal(chooseLatestInvite([olderInvite, newerInvite], 1_700_000_000)?.code, 'newer');
  });
});
