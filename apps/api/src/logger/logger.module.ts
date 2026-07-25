import { randomUUID } from 'node:crypto';

import { Global, Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';

import { REQUEST_ID_PATTERN } from '../common/constants';
import { ConfigService } from '../config/config.service';

/**
 * Structured JSON logging via Pino (spec §10). Handles the full request-id
 * lifecycle in one place: accept a valid incoming `x-request-id`, otherwise
 * generate a UUID, echo it back in the response header, and stamp it on every
 * log line as `requestId`. Secrets are redacted.
 */
@Global()
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          base: { service: 'api', environment: config.get('NODE_ENV') },
          messageKey: 'message',
          timestamp: stdTimeFunctions.isoTime,
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id =
              typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
                ? incoming
                : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          customProps: (req) => ({ requestId: (req as { id?: string }).id }),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.passwordHash',
              '*.password',
              '*.passwordHash',
              '*.password_hash',
              '*.accessToken',
              'res.headers["set-cookie"]',
            ],
            censor: '[REDACTED]',
          },
          ...(config.get('NODE_ENV') === 'production'
            ? {}
            : { transport: { target: 'pino-pretty', options: { singleLine: true } } }),
        },
      }),
    }),
  ],
})
export class LoggerModule {}
