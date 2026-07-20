import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Task } from './entities/task.entity';
import { ConfigService } from '../config/config.service';

/**
 * Worker DB access. Reads tasks and updates the exports table (the latter via
 * raw SQL for atomic conditional status claims). Never runs migrations — the
 * API owns the schema.
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
    TypeOrmModule.forFeature([Task]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
