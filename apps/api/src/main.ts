import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // Route Nest's logger through Pino (structured JSON).
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);

  // Behind the ALB, trust the first proxy so req.ip is the real client
  // (correct per-IP rate limiting).
  app.set('trust proxy', 1);

  // Operational endpoints (/health, /ready) stay outside the versioned prefix.
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });

  const origins = config.corsOrigins;
  app.enableCors({ origin: origins.length > 0 ? origins : false, credentials: true });

  // OpenAPI at /docs (spec §8). NOTE: nestjs-zod's Swagger monkey-patch is
  // incompatible with @nestjs/swagger v11 internals, so it is intentionally not
  // used — routes are documented, but zod DTO request bodies show without a
  // detailed schema. See DEVIATIONS.md.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('CloudTask API')
    .setDescription('CloudTask HTTP API')
    .setVersion('1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  app.enableShutdownHooks();
  await app.listen(config.get('PORT'), '0.0.0.0');
}

void bootstrap();
