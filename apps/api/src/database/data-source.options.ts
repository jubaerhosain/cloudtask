import { join } from 'node:path';

import { DataSourceOptions } from 'typeorm';

/**
 * Build TypeORM options from the single canonical `DATABASE_URL` (spec §17).
 * Shared by the NestJS DatabaseModule and the CLI data-source used for
 * migrations. `synchronize` is always false — schema changes go through
 * migrations only.
 */
export function buildDataSourceOptions(databaseUrl: string): DataSourceOptions {
  // __dirname is src/database under ts-node (CLI) and dist/database once built,
  // so these globs resolve to the right extension in each context.
  const root = join(__dirname, '..');
  return {
    type: 'postgres',
    url: databaseUrl,
    entities: [join(root, '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    migrationsRun: false,
    logging: false,
  };
}
