import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

/**
 * Worker bootstrap — a NestJS standalone application context (no HTTP server).
 * The SQS consumer starts via its onApplicationBootstrap hook; SIGTERM/SIGINT
 * trigger a graceful shutdown that stops polling and finishes the current
 * message before exiting (spec §18, §24).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  app.enableShutdownHooks();

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void app.close().then(resolve);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  });

  process.exit(0);
}

void bootstrap();
