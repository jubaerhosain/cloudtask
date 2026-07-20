import pino, { Logger } from 'pino';

/**
 * Structured JSON logger for the worker (spec §10). Fields: level, timestamp,
 * service, environment, plus per-message correlation added by callers.
 */
export function createLogger(level: string, environment: string): Logger {
  return pino({
    level,
    messageKey: 'message',
    base: { service: 'worker', environment },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['*.password', '*.passwordHash', '*.password_hash', '*.accessToken'],
      censor: '[REDACTED]',
    },
  });
}

export const LOGGER = Symbol('LOGGER');
export type { Logger };
