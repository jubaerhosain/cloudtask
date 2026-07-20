import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

/**
 * Worker bootstrap — a NestJS standalone application context with NO HTTP
 * server (spec §17: the worker has no PORT and no load balancer).
 *
 * Milestone 5 replaces the idle keep-alive below with the SQS long-poll loop
 * and wires graceful shutdown to stop polling and finish/abandon the current
 * message safely.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();

  const logger = new Logger('Worker');
  logger.log('Worker started (M1 shell — SQS polling arrives in Milestone 5)');

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Keep the process alive until a shutdown signal arrives.
  await new Promise<void>(() => {});
}

void bootstrap();
