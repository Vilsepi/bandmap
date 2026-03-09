import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeRecommendationSourceArtistName } from './recommendations.js';

describe('normalizeRecommendationSourceArtistName', () => {
  it('trims valid source artist names', () => {
    assert.equal(normalizeRecommendationSourceArtistName('  Rosetta  '), 'Rosetta');
  });

  it('treats empty values as missing', () => {
    assert.equal(normalizeRecommendationSourceArtistName('   '), '');
    assert.equal(normalizeRecommendationSourceArtistName(null), '');
    assert.equal(normalizeRecommendationSourceArtistName(undefined), '');
  });

  it('treats Unknown as missing', () => {
    assert.equal(normalizeRecommendationSourceArtistName('Unknown'), '');
    assert.equal(normalizeRecommendationSourceArtistName(' unknown '), '');
  });
});
