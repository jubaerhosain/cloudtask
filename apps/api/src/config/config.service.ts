import { ApiConfig } from '@cloudtask/contracts';
import { Injectable } from '@nestjs/common';

/**
 * Typed accessor over the validated API configuration.
 *
 * The raw values are validated once at startup (see ConfigModule); this service
 * exposes them with types plus a couple of derived helpers.
 */
@Injectable()
export class ConfigService {
  constructor(private readonly config: ApiConfig) {}

  get<K extends keyof ApiConfig>(key: K): ApiConfig[K] {
    return this.config[key];
  }

  /** Parsed, trimmed list of allowed CORS origins. */
  get corsOrigins(): string[] {
    return this.config.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  get isProduction(): boolean {
    return this.config.NODE_ENV === 'production';
  }

  /** The full validated config (read-only snapshot). */
  get values(): Readonly<ApiConfig> {
    return this.config;
  }
}
