import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'cloudtask:rateLimit';

export interface RateLimitOptions {
  /** Namespace for the limit (part of the Redis key). */
  name: string;
  limit: number;
  windowSec: number;
  /** Key requests by client IP or authenticated user. */
  keyBy: 'ip' | 'user';
}

/** Applies a rate limit to a route (enforced by RateLimitGuard). */
export const RateLimit = (options: RateLimitOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);
