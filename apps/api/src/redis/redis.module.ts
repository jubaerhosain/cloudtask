import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

import { ConfigService } from '../config/config.service';
import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis =>
        new Redis({
          host: config.get('REDIS_HOST'),
          port: config.get('REDIS_PORT'),
          ...(config.get('REDIS_TLS_ENABLED') ? { tls: {} } : {}),
          // Fail fast when Redis is down so callers can fall back rather than
          // hang; ioredis keeps retrying the connection in the background.
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        }),
    },
    RedisService,
  ],
  exports: [RedisService],
})
export class RedisModule {}
