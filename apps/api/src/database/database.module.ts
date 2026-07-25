import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConfigService } from '../config/config.service';

/**
 * Wires TypeORM using the validated DATABASE_URL. Entities are attached by
 * feature modules via `TypeOrmModule.forFeature` and discovered through
 * `autoLoadEntities` — the runtime never relies on filesystem globs (those are
 * only used by the CLI data-source for migrations). Schema changes always go
 * through migrations; `synchronize` is off.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
        logging: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
