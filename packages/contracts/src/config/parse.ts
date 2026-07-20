import { z } from 'zod';

/** Thrown when environment configuration fails validation. */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    readonly issues: z.ZodIssue[],
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validate an environment object against a schema.
 *
 * On failure it aggregates ALL issues into a single, human-readable message
 * (not just the first) so an operator can fix everything at once. Callers
 * (the API/worker bootstrap) are expected to print `error.message` and exit
 * with a non-zero code — this library never calls `process.exit` itself.
 */
export function parseConfig<T extends z.ZodTypeAny>(
  schema: T,
  env: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(env);
  if (result.success) {
    return result.data;
  }

  const lines = result.error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    return `  - ${key}: ${issue.message}`;
  });
  const message = `Invalid configuration:\n${lines.join('\n')}`;
  throw new ConfigValidationError(message, result.error.issues);
}
