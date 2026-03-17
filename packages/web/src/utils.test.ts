import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { formatEpochSeconds } from './utils.js';

describe('formatEpochSeconds', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('converts Unix epoch seconds to a locale-formatted date', () => {
    const toLocaleString = mock.method(
      Date.prototype,
      'toLocaleString',
      function toLocaleStringStub(this: Date) {
        return this.toISOString();
      },
    );

    const formatted = formatEpochSeconds(1738454400);

    assert.equal(formatted, '2025-02-02T00:00:00.000Z');
    assert.equal(toLocaleString.mock.calls.length, 1);
  });
});
