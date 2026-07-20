import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

import { REDIS_CLIENT } from './redis.constants';

/**
 * Thin wrapper over ioredis that degrades gracefully: cache operations never
 * throw (they log a warning once and return a safe default), so the API stays
 * functional when Redis is down (spec §6.4, §23).
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private warned = false;

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {
    this.client.on('error', (err) => this.warnOnce(err.message));
    this.client.on('ready', () => {
      this.warned = false;
      this.logger.log('Redis connection ready');
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.client.status === 'wait') {
      try {
        await this.client.connect();
      } catch (err) {
        this.warnOnce((err as Error).message);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      // ignore shutdown errors
    }
  }

  /** True only when the client is connected and ready to serve commands. */
  isAvailable(): boolean {
    return this.client.status === 'ready';
  }

  /** Raw client for callers that need atomic primitives (e.g. rate-limit Lua). */
  get raw(): Redis {
    return this.client;
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (err) {
      this.warnOnce((err as Error).message);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    try {
      if (ttlSeconds !== undefined) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch (err) {
      this.warnOnce((err as Error).message);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      await this.client.del(key);
      return true;
    } catch (err) {
      this.warnOnce((err as Error).message);
      return false;
    }
  }

  private warnOnce(message: string): void {
    if (!this.warned) {
      this.logger.warn(`Redis unavailable, continuing without it: ${message}`);
      this.warned = true;
    }
  }
}
