import { Response } from 'express';
import { DataSource } from 'typeorm';

import { HealthController } from './health.controller';
import { RedisService } from '../redis/redis.service';

function mockResponse(): Response {
  return { status: jest.fn() } as unknown as Response;
}

describe('HealthController', () => {
  it('/health returns ok without touching Postgres or Redis', () => {
    const dataSource = { query: jest.fn() } as unknown as DataSource;
    const redis = { ping: jest.fn() } as unknown as RedisService;
    const controller = new HealthController(dataSource, redis);

    expect(controller.health()).toEqual({ status: 'ok' });
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('/ready is ok (200) when Postgres and Redis are up', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{}]) } as unknown as DataSource;
    const redis = { ping: jest.fn().mockResolvedValue(true) } as unknown as RedisService;
    const res = mockResponse();

    const result = await new HealthController(dataSource, redis).ready(res);

    expect(result).toEqual({ status: 'ok', checks: { postgres: 'up', redis: 'up' } });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('/ready is degraded (still 200) when only Redis is down', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{}]) } as unknown as DataSource;
    const redis = { ping: jest.fn().mockResolvedValue(false) } as unknown as RedisService;
    const res = mockResponse();

    const result = await new HealthController(dataSource, redis).ready(res);

    expect(result).toEqual({ status: 'degraded', checks: { postgres: 'up', redis: 'down' } });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('/ready is unhealthy (503) when Postgres is down', async () => {
    const dataSource = {
      query: jest.fn().mockRejectedValue(new Error('no connection')),
    } as unknown as DataSource;
    const redis = { ping: jest.fn().mockResolvedValue(true) } as unknown as RedisService;
    const res = mockResponse();

    const result = await new HealthController(dataSource, redis).ready(res);

    expect(result.status).toBe('unhealthy');
    expect(result.checks.postgres).toBe('down');
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
