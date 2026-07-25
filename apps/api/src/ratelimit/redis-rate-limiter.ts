import { RateLimiter, RateLimitResult } from './rate-limiter.interface';
import { RedisService } from '../redis/redis.service';

// Atomic fixed-window counter: INCR the key, set the TTL on first hit, and
// return both the count and the remaining TTL in one round trip.
const CONSUME_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local pttl = redis.call('PTTL', KEYS[1])
return {current, pttl}
`;

/** Redis-backed limiter shared across all API tasks. */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: RedisService) {}

  async consume(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const windowMs = windowSec * 1000;
    const [count, pttl] = (await this.redis.raw.eval(
      CONSUME_SCRIPT,
      1,
      key,
      String(windowMs),
    )) as [number, number];

    const resetAtMs = Date.now() + (pttl >= 0 ? pttl : windowMs);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAtMs,
      limit,
    };
  }
}
