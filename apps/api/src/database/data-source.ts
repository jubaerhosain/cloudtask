import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';

import { buildDataSourceOptions } from './data-source.options';

// Standalone DataSource for the TypeORM CLI (migration:generate/run/revert).
// Load .env for host runs; in Docker/ECS the env is already populated.
loadDotenv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set to run TypeORM migrations');
}

export default new DataSource(buildDataSourceOptions(databaseUrl));
