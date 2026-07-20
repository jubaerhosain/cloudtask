import { ConfigValidationError, parseConfig, workerConfigSchema } from '@cloudtask/contracts';
import { Global, Module } from '@nestjs/common';

import { ConfigService } from './config.service';

function loadConfigService(): ConfigService {
  try {
    return new ConfigService(parseConfig(workerConfigSchema, process.env));
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error(`\n[config] Worker failed to start — ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

@Global()
@Module({
  providers: [{ provide: ConfigService, useFactory: loadConfigService }],
  exports: [ConfigService],
})
export class ConfigModule {}
