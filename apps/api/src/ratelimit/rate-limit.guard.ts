import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';

import { RATE_LIMIT_KEY, RateLimitOptions } from './rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';
import { AuthenticatedUser } from '../common/types';

/**
 * Enforces `@RateLimit(...)` metadata. Runs after the JWT guard so that
 * `keyBy: 'user'` has access to `request.user`. Sets the standard
 * `X-RateLimit-*` headers and, on rejection, a `Retry-After` header plus a 429.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly service: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const response = context.switchToHttp().getResponse<Response>();

    const identity = options.keyBy === 'user' ? (request.user?.userId ?? request.ip) : request.ip;
    const key = `rl:${options.name}:${identity}`;

    const result = await this.service.consume(key, options.limit, options.windowSec);

    response.setHeader('X-RateLimit-Limit', options.limit);
    response.setHeader('X-RateLimit-Remaining', result.remaining);
    response.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAtMs / 1000));

    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAtMs - Date.now()) / 1000));
      response.setHeader('Retry-After', retryAfter);
      throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
