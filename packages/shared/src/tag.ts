import { createHash } from 'node:crypto';

/**
 * Normalize a tag name for consistent comparison and ID generation.
 * - lowercase
 * - trim whitespace
 * - collapse multiple spaces to single space
 * - NFC unicode normalize
 */
export function normalizeTagName(name: string): string {
  return name.toLowerCase().trim().replaceAll(/\s+/g, ' ').normalize('NFC');
}

/**
 * Compute a deterministic ID for a tag based on its normalized name.
 * Returns first 16 hex characters of the SHA-256 hash (64 bits).
 */
export function tagId(name: string): string {
  const normalized = normalizeTagName(name);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
