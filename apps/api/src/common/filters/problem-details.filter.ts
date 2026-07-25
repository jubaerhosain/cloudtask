import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';

import { PROBLEM_TYPE_BASE } from '../constants';

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  requestId?: string;
  errors?: { path: string; message: string }[];
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

function slug(status: number): string {
  return (TITLES[status] ?? 'error').toLowerCase().replace(/\s+/g, '-');
}

/**
 * Converts every thrown error into an `application/problem+json` response
 * (RFC 7807, spec §8). Unknown errors are logged with their stack and the
 * requestId, and never leak internals to the client.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();
    const requestId = request.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let detail: string | undefined;
    let errors: { path: string; message: string }[] | undefined;

    if (exception instanceof ZodValidationException) {
      status = HttpStatus.BAD_REQUEST;
      detail = 'Request validation failed';
      errors = exception.getZodError().issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      detail = extractDetail(exception.getResponse());
    } else {
      // Unknown/unexpected error: log the real cause, expose nothing.
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        `Unhandled exception (requestId=${requestId ?? 'n/a'}): ${err.name}: ${err.message}`,
        err.stack,
      );
      detail = 'An unexpected error occurred';
    }

    const title = TITLES[status] ?? 'Error';
    const body: ProblemBody = {
      type: `${PROBLEM_TYPE_BASE}/${slug(status)}`,
      title,
      status,
      instance: request.originalUrl ?? request.url,
      ...(detail ? { detail } : {}),
      ...(requestId ? { requestId } : {}),
      ...(errors ? { errors } : {}),
    };

    response.status(status).type('application/problem+json').json(body);
  }
}

/** Pull a human-readable detail out of an HttpException response payload. */
function extractDetail(payload: string | object): string | undefined {
  if (typeof payload === 'string') return payload;
  const message = (payload as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join(', ');
  return undefined;
}
