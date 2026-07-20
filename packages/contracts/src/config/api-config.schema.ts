import { z } from 'zod';

import { zBooleanEnv, zIntEnv, zLogLevel, zNodeEnv } from './env.js';

/**
 * API service configuration contract (spec §17).
 *
 * `DATABASE_URL` is the single canonical DB config — no discrete DB_* vars.
 * Redis config applies to the API only. AWS-related values are optional in
 * development/test (the auth slice does not need SQS/S3) but required in
 * production, enforced by the `superRefine` below.
 */
export const apiConfigSchema = z
  .object({
    NODE_ENV: zNodeEnv,
    PORT: zIntEnv.pipe(z.number().int().positive()).default(3000),

    // Database (secret in AWS, injected from Secrets Manager)
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // Redis (API only)
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: zIntEnv.pipe(z.number().int().positive()).default(6379),
    REDIS_TLS_ENABLED: zBooleanEnv.default(false),

    // Auth (secret in AWS)
    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),

    // AWS (optional in dev/test, required in production)
    AWS_REGION: z.string().optional(),
    EXPORT_QUEUE_URL: z.string().url().optional(),
    EXPORT_BUCKET_NAME: z.string().optional(),
    /** Local only (LocalStack). Must be unset in AWS. */
    AWS_ENDPOINT_URL: z.string().url().optional(),

    LOG_LEVEL: zLogLevel,
    /** Comma-separated list of allowed CORS origins. */
    CORS_ORIGINS: z.string().default(''),

    /** Dev-only failure-injection endpoint toggle. Never enabled in production. */
    ENABLE_FAILURE_ENDPOINTS: zBooleanEnv.default(false),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV === 'production') {
      for (const key of ['AWS_REGION', 'EXPORT_QUEUE_URL', 'EXPORT_BUCKET_NAME'] as const) {
        if (!cfg[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required in production`,
          });
        }
      }
      if (cfg.ENABLE_FAILURE_ENDPOINTS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ENABLE_FAILURE_ENDPOINTS'],
          message: 'ENABLE_FAILURE_ENDPOINTS must never be true in production',
        });
      }
    }
  });

export type ApiConfig = z.infer<typeof apiConfigSchema>;
