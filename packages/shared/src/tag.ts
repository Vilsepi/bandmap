import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

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
  return bytesToHex(sha256(utf8ToBytes(normalized))).slice(0, 16);
}
