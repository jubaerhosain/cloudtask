import { Global, Module } from '@nestjs/common';

import { createLogger, LOGGER } from './logger';
import { ConfigService } from '../config/config.service';

@Global()
@Module({
  providers: [
    {
      provide: LOGGER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createLogger(config.get('LOG_LEVEL'), config.get('NODE_ENV')),
    },
  ],
  exports: [LOGGER],
})
export class LoggerModule {}
