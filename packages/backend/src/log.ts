type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogContext = Record<string, unknown>;
type LogMethod = (contextOrMessage: string | LogContext, message?: string) => void;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getConfiguredLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (
    configured === 'debug' ||
    configured === 'info' ||
    configured === 'warn' ||
    configured === 'error'
  ) {
    return configured;
  }

  return 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[getConfiguredLevel()];
}

function serializeContext(context: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, serializeValue(value)]),
  );
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  return value;
}

function writeLog(level: LogLevel, contextOrMessage: string | LogContext, message?: string): void {
  if (!shouldLog(level)) {
    return;
  }

  const payload: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
  };

  if (typeof contextOrMessage === 'string') {
    payload.msg = contextOrMessage;
  } else {
    Object.assign(payload, serializeContext(contextOrMessage));
    if (message) {
      payload.msg = message;
    }
  }

  const line = JSON.stringify(payload);

  switch (level) {
    case 'debug':
    case 'info':
      console.log(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'error':
      console.error(line);
      break;
  }
}

export const logger: Record<LogLevel, LogMethod> = {
  debug: (contextOrMessage, message) => writeLog('debug', contextOrMessage, message),
  info: (contextOrMessage, message) => writeLog('info', contextOrMessage, message),
  warn: (contextOrMessage, message) => writeLog('warn', contextOrMessage, message),
  error: (contextOrMessage, message) => writeLog('error', contextOrMessage, message),
};
