import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const authPageHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

describe('invite signup notice', () => {
  it('includes the password requirements and reset guidance', () => {
    assert.match(authPageHtml, /Passwords must be at least 8 characters long\./);
    assert.match(authPageHtml, /Self-service password reset is not available yet/);
    assert.match(authPageHtml, /if you forget your password, ask an admin to reset it\./);
  });
});
