import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { DebugModule } from './debug/debug.module';
import { HealthModule } from './health/health.module';
import { LoggerModule } from './logger/logger.module';
import { ProjectsModule } from './projects/projects.module';
import { RateLimitGuard } from './ratelimit/rate-limit.guard';
import { RateLimitModule } from './ratelimit/ratelimit.module';
import { RedisModule } from './redis/redis.module';
import { TasksModule } from './tasks/tasks.module';

/**
 * Composition root. Global modules load first so their providers are available
 * to the feature modules' async factories. The debug module is only registered
 * when failure injection is enabled (spec §6.8).
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule,
    RateLimitModule,
    AuthModule,
    ProjectsModule,
    TasksModule,
    HealthModule,
    ...(process.env.ENABLE_FAILURE_ENDPOINTS === 'true' ? [DebugModule] : []),
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    // JWT guard runs first so req.user is populated before the rate-limit guard.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
