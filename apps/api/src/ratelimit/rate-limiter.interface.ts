export interface RateLimitResult {
  allowed: boolean;
  /** Requests remaining in the current window. */
  remaining: number;
  /** Epoch millis when the current window resets. */
  resetAtMs: number;
  limit: number;
}

export interface RateLimiter {
  /** Consume one unit against `key`. Fixed window of `windowSec` seconds. */
  consume(key: string, limit: number, windowSec: number): Promise<RateLimitResult>;
}
