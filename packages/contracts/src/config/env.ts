import { z } from 'zod';

/**
 * Reusable primitives for parsing environment variables.
 *
 * Environment variables arrive as strings, so numbers and booleans must be
 * coerced. These helpers keep coercion consistent across the API and worker.
 */

/** Coerce common string forms of a boolean env var into a real boolean. */
export const zBooleanEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  });

/** A positive integer parsed from a string env var. */
export const zIntEnv = z.coerce.number().int();

/** The runtime environment name. */
export const zNodeEnv = z.enum(['development', 'test', 'production']).default('development');

/** Pino log levels. */
export const zLogLevel = z
  .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  .default('info');
