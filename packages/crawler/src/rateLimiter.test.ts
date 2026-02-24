import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from './rateLimiter.js';

describe('RateLimiter', () => {
  it('executes function successfully', async () => {
    const limiter = new RateLimiter();
    const result = await limiter.execute(
      async () => 42,
      () => false,
    );
    assert.equal(result, 42);
  });

  it('retries on retryable errors', async () => {
    const limiter = new RateLimiter();
    let attempts = 0;

    const result = await limiter.execute(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('temporary');
        }
        return 'success';
      },
      () => true,
    );

    assert.equal(result, 'success');
    assert.equal(attempts, 3);
  });

  it('does not retry non-retryable errors', async () => {
    const limiter = new RateLimiter();
    let attempts = 0;

    await assert.rejects(
      () =>
        limiter.execute(
          async () => {
            attempts++;
            throw new Error('permanent');
          },
          () => false,
        ),
      { message: 'permanent' },
    );

    assert.equal(attempts, 1);
  });

  it('enforces minimum interval between requests', async () => {
    const limiter = new RateLimiter();
    const start = Date.now();

    await limiter.waitForSlot();
    await limiter.waitForSlot();

    const elapsed = Date.now() - start;
    // Second call should have waited ~1000ms
    assert.ok(elapsed >= 900, `Expected >= 900ms, got ${elapsed}ms`);
  });
});
