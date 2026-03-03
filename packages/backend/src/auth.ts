import type { User } from '@bandmap/shared';
import * as db from './db.js';

/**
 * Authenticate a request by extracting the x-api-key header and looking up the user.
 * Returns the User if valid, or null if the key is missing/invalid.
 */
export async function authenticate(
  headers: Record<string, string | undefined>,
): Promise<User | null> {
  const apiKey = headers['x-api-key'];
  if (!apiKey) {
    return null;
  }
  return db.getUser(apiKey);
}
