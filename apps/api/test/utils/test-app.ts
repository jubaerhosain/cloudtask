import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { DataSource } from 'typeorm';

/**
 * Boots a fully-wired API against real Postgres + Redis containers and runs the
 * real migrations (not `synchronize`), so integration tests exercise the same
 * schema and DI graph as production.
 *
 * If TEST_DATABASE_URL / TEST_REDIS_HOST are provided (e.g. CI service
 * containers), those are used instead of starting Testcontainers.
 */
export interface TestContext {
  app: INestApplication;
  close: () => Promise<void>;
}

export async function createTestApp(
  configure?: (builder: TestingModuleBuilder) => void,
): Promise<TestContext> {
  let pgContainer: StartedPostgreSqlContainer | undefined;
  let redisContainer: StartedRedisContainer | undefined;

  let databaseUrl = process.env.TEST_DATABASE_URL;
  let redisHost = process.env.TEST_REDIS_HOST;
  let redisPort = process.env.TEST_REDIS_PORT;

  if (!databaseUrl) {
    pgContainer = await new PostgreSqlContainer('postgres:16').start();
    databaseUrl = pgContainer.getConnectionUri();
  }
  if (!redisHost) {
    redisContainer = await new RedisContainer('redis:7').start();
    redisHost = redisContainer.getHost();
    redisPort = String(redisContainer.getMappedPort(6379));
  }

  // Configure the environment BEFORE the config module validates it.
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_HOST = redisHost;
  process.env.REDIS_PORT = redisPort ?? '6379';
  process.env.REDIS_TLS_ENABLED = 'false';
  process.env.JWT_SECRET = 'test-secret-value-at-least-16-chars';
  process.env.LOG_LEVEL = 'silent';
  process.env.CORS_ORIGINS = '';

  // Flush Redis so rate-limit counters and cached summaries don't leak between
  // suites when a shared Redis is reused (e.g. the CI service container). With
  // per-suite Testcontainers this is a harmless no-op.
  const Redis = (await import('ioredis')).default;
  const flusher = new Redis({ host: redisHost, port: Number(redisPort ?? '6379') });
  try {
    await flusher.flushdb();
  } finally {
    await flusher.quit();
  }

  // Run migrations against a temporary DataSource. Entities/migrations are
  // referenced by class (not globs) so this loads cleanly under ts-jest.
  const { User } = await import('../../src/users/user.entity');
  const { Project } = await import('../../src/projects/project.entity');
  const { Task } = await import('../../src/tasks/task.entity');
  const { ExportJob } = await import('../../src/exports/export.entity');
  const { CreateUsers1720000000000 } = await import(
    '../../src/database/migrations/1720000000000-CreateUsers'
  );
  const { CreateProjects1720000001000 } = await import(
    '../../src/database/migrations/1720000001000-CreateProjects'
  );
  const { CreateTasks1720000002000 } = await import(
    '../../src/database/migrations/1720000002000-CreateTasks'
  );
  const { CreateExports1720000003000 } = await import(
    '../../src/database/migrations/1720000003000-CreateExports'
  );
  const migrator = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    entities: [User, Project, Task, ExportJob],
    migrations: [
      CreateUsers1720000000000,
      CreateProjects1720000001000,
      CreateTasks1720000002000,
      CreateExports1720000003000,
    ],
    synchronize: false,
  });
  await migrator.initialize();
  await migrator.runMigrations();
  await migrator.destroy();

  const { AppModule } = await import('../../src/app.module');
  const builder = Test.createTestingModule({ imports: [AppModule] });
  configure?.(builder);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  // Mirror main.ts: operational endpoints stay outside the versioned prefix.
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  await app.init();

  const close = async (): Promise<void> => {
    await app.close();
    if (redisContainer) await redisContainer.stop();
    if (pgContainer) await pgContainer.stop();
  };

  return { app, close };
}
