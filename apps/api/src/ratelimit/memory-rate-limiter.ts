import { RateLimiter, RateLimitResult } from './rate-limiter.interface';

interface Bucket {
  count: number;
  resetAtMs: number;
}

/**
 * Conservative in-memory fallback for a single API task (spec §6.6). State is
 * per-process, so it is intentionally stricter than a shared limiter would be.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private static readonly MAX_ENTRIES = 10_000;

  consume(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSec * 1000;
    let bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAtMs) {
      bucket = { count: 0, resetAtMs: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (this.buckets.size > MemoryRateLimiter.MAX_ENTRIES) {
      this.evictExpired(now);
    }

    return Promise.resolve({
      allowed: bucket.count <= limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAtMs: bucket.resetAtMs,
      limit,
    });
  }

  private evictExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAtMs) {
        this.buckets.delete(key);
      }
    }
  }
}
