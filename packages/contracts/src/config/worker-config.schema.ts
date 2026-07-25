import { z } from 'zod';

import { zIntEnv, zLogLevel, zNodeEnv } from './env.js';

/**
 * Worker service configuration contract (spec §17).
 *
 * The worker does NOT connect to Redis and has no HTTP port. AWS values are
 * required in production (the worker's whole job is SQS -> S3).
 */
export const workerConfigSchema = z
  .object({
    NODE_ENV: zNodeEnv,

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    AWS_REGION: z.string().optional(),
    EXPORT_QUEUE_URL: z.string().url().optional(),
    EXPORT_BUCKET_NAME: z.string().optional(),
    /** Local only (LocalStack). Must be unset in AWS. */
    AWS_ENDPOINT_URL: z.string().url().optional(),

    SQS_WAIT_TIME_SECONDS: zIntEnv.pipe(z.number().int().min(0).max(20)).default(20),
    SQS_VISIBILITY_TIMEOUT_SECONDS: zIntEnv.pipe(z.number().int().positive()).default(60),

    LOG_LEVEL: zLogLevel,
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
    }
  });

export type WorkerConfig = z.infer<typeof workerConfigSchema>;
