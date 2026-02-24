import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTagName, tagId } from './tag.js';

describe('normalizeTagName', () => {
  it('lowercases', () => {
    assert.equal(normalizeTagName('Post-Metal'), 'post-metal');
  });

  it('trims whitespace', () => {
    assert.equal(normalizeTagName('  rock  '), 'rock');
  });

  it('collapses multiple spaces', () => {
    assert.equal(normalizeTagName('trip   hop'), 'trip hop');
  });

  it('applies NFC unicode normalization', () => {
    // é as combining sequence (NFD) vs precomposed (NFC)
    const nfd = 'cafe\u0301'; // cafe + combining acute
    const nfc = 'caf\u00e9'; // precomposed é
    assert.equal(normalizeTagName(nfd), normalizeTagName(nfc));
  });

  it('handles all normalizations together', () => {
    assert.equal(normalizeTagName('  Post   Metal  '), 'post metal');
  });
});

describe('tagId', () => {
  it('returns a 16-char hex string', () => {
    const id = tagId('rock');
    assert.equal(id.length, 16);
    assert.match(id, /^[0-9a-f]{16}$/);
  });

  it('is deterministic', () => {
    assert.equal(tagId('post-metal'), tagId('post-metal'));
  });

  it('is case-insensitive (normalization)', () => {
    assert.equal(tagId('Post-Metal'), tagId('post-metal'));
  });

  it('treats different whitespace forms the same', () => {
    assert.equal(tagId('  trip   hop  '), tagId('trip hop'));
  });

  it('produces different IDs for different names', () => {
    assert.notEqual(tagId('rock'), tagId('metal'));
  });

  it('produces known hash for post-metal', () => {
    assert.equal(tagId('post-metal'), 'ee2bea8034b7402c');
  });
});
