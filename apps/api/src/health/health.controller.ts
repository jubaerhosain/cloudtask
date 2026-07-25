import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { DataSource } from 'typeorm';

import { Public } from '../common/decorators/public.decorator';
import { RedisService } from '../redis/redis.service';

type CheckState = 'up' | 'down';

/**
 * Operational endpoints (spec §9). Registered OUTSIDE the /api/v1 prefix and
 * marked @Public so the ALB can reach them without a token.
 */
@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  /** Liveness — returns 200 whenever the process is up. No I/O. */
  @Public()
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness — Postgres is fatal (503), Redis is degraded (still 200). */
  @Public()
  @Get('ready')
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: 'ok' | 'degraded' | 'unhealthy'; checks: Record<string, CheckState> }> {
    const postgresUp = await this.checkPostgres();
    const redisUp = await this.redis.ping();

    let status: 'ok' | 'degraded' | 'unhealthy' = 'ok';
    if (!postgresUp) {
      status = 'unhealthy';
      res.status(503);
    } else if (!redisUp) {
      status = 'degraded';
    }

    return {
      status,
      checks: { postgres: postgresUp ? 'up' : 'down', redis: redisUp ? 'up' : 'down' },
    };
  }

  private async checkPostgres(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
