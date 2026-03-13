const DEBUG_LOG_LEVEL = 'DEBUG';

export function isDebugLoggingEnabled(): boolean {
  return process.env.LOG_LEVEL?.toUpperCase() === DEBUG_LOG_LEVEL;
}

export function logDebug(message?: unknown, ...optionalParams: unknown[]): void {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  console.debug(message, ...optionalParams);
}
