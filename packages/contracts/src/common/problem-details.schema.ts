import { z } from 'zod';

/**
 * RFC 7807 problem-details envelope (spec §8).
 *
 * Shared so the frontend can parse API errors with the same shape the API
 * produces.
 */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  /** Optional per-field validation errors extension member. */
  errors: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
