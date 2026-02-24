/**
 * Rate limiter: enforces 1 request per second with exponential backoff on failure.
 */

const INITIAL_DELAY_MS = 1000; // 1 request per second
const MAX_RETRIES = 5;

const BACKOFF_DELAYS_MS = [2000, 4000, 8000, 16000, 32000];

export class RateLimiter {
  private lastRequestTime = 0;

  /**
   * Wait until we can make the next request (enforces minimum interval).
   */
  async waitForSlot(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < INITIAL_DELAY_MS) {
      await this.sleep(INITIAL_DELAY_MS - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Execute a function with rate limiting and exponential backoff.
   * Retries on retryable errors up to MAX_RETRIES times.
   */
  async execute<T>(fn: () => Promise<T>, isRetryable: (error: unknown) => boolean): Promise<T> {
    let attempt = 0;

    while (true) {
      await this.waitForSlot();

      try {
        return await fn();
      } catch (error: unknown) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) {
          throw error;
        }

        const delay = BACKOFF_DELAYS_MS[attempt] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1];
        attempt++;
        console.warn(
          `Request failed (attempt ${attempt}/${MAX_RETRIES + 1}), retrying in ${delay}ms...`,
        );
        await this.sleep(delay);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
