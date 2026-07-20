import { Injectable, Logger } from '@nestjs/common';

import { MemoryRateLimiter } from './memory-rate-limiter';
import { RateLimitResult } from './rate-limiter.interface';
import { RedisRateLimiter } from './redis-rate-limiter';
import { RedisService } from '../redis/redis.service';

/**
 * Chooses the limiter per call: Redis when available, otherwise the in-memory
 * fallback. Selection is per-call (not at boot) so the service self-heals when
 * Redis comes back, and any runtime Redis error also falls back safely.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly redisLimiter: RedisRateLimiter;
  private readonly memoryLimiter = new MemoryRateLimiter();

  constructor(private readonly redisService: RedisService) {
    this.redisLimiter = new RedisRateLimiter(redisService);
  }

  async consume(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    if (this.redisService.isAvailable()) {
      try {
        return await this.redisLimiter.consume(key, limit, windowSec);
      } catch (err) {
        this.logger.warn(`Redis rate-limit failed, using memory fallback: ${(err as Error).message}`);
      }
    }
    return this.memoryLimiter.consume(key, limit, windowSec);
  }
}
