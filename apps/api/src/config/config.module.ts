import { apiConfigSchema, ConfigValidationError, parseConfig } from '@cloudtask/contracts';
import { Global, Module } from '@nestjs/common';

import { ConfigService } from './config.service';

/**
 * Validate `process.env` against the API config schema exactly once, at module
 * construction. On failure we print every problem and exit with a non-zero
 * code (spec §17) rather than booting in a half-configured state.
 */
function loadConfigService(): ConfigService {
  try {
    return new ConfigService(parseConfig(apiConfigSchema, process.env));
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      // eslint-disable-next-line no-console
      console.error(`\n[config] Failed to start — ${err.message}\n`);
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
