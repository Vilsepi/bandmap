import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { isDebugLoggingEnabled, logDebug } from './log.js';

describe('logDebug', () => {
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalConsoleDebug = console.debug;

  afterEach(() => {
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
    console.debug = originalConsoleDebug;
  });

  it('enables debug logging only when LOG_LEVEL is DEBUG', () => {
    delete process.env.LOG_LEVEL;
    assert.equal(isDebugLoggingEnabled(), false);

    process.env.LOG_LEVEL = 'info';
    assert.equal(isDebugLoggingEnabled(), false);

    process.env.LOG_LEVEL = 'DEBUG';
    assert.equal(isDebugLoggingEnabled(), true);
  });

  it('writes debug messages when debug logging is enabled', () => {
    const calls: unknown[][] = [];
    console.debug = (...args: unknown[]) => {
      calls.push(args);
    };
    process.env.LOG_LEVEL = 'DEBUG';

    logDebug('Incoming query', { q: 'rosetta' });

    assert.deepEqual(calls, [['Incoming query', { q: 'rosetta' }]]);
  });

  it('skips debug messages when debug logging is disabled', () => {
    let called = false;
    console.debug = () => {
      called = true;
    };
    process.env.LOG_LEVEL = 'INFO';

    logDebug('Incoming query');

    assert.equal(called, false);
  });
});
