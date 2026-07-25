import { describe, expect, it } from 'vitest';

import { apiConfigSchema } from './api-config.schema.js';
import { ConfigValidationError, parseConfig } from './parse.js';
import { workerConfigSchema } from './worker-config.schema.js';

const baseApiEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_SECRET: 'a-sufficiently-long-secret-value',
};

const baseWorkerEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
};

describe('apiConfigSchema', () => {
  it('applies defaults for optional values', () => {
    const cfg = parseConfig(apiConfigSchema, { ...baseApiEnv });
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.PORT).toBe(3000);
    expect(cfg.REDIS_HOST).toBe('localhost');
    expect(cfg.REDIS_PORT).toBe(6379);
    expect(cfg.REDIS_TLS_ENABLED).toBe(false);
    expect(cfg.LOG_LEVEL).toBe('info');
    expect(cfg.CORS_ORIGINS).toBe('');
    expect(cfg.ENABLE_FAILURE_ENDPOINTS).toBe(false);
  });

  it('coerces numeric and boolean env strings', () => {
    const cfg = parseConfig(apiConfigSchema, {
      ...baseApiEnv,
      PORT: '4000',
      REDIS_PORT: '6380',
      REDIS_TLS_ENABLED: 'true',
      ENABLE_FAILURE_ENDPOINTS: '1',
    });
    expect(cfg.PORT).toBe(4000);
    expect(cfg.REDIS_PORT).toBe(6380);
    expect(cfg.REDIS_TLS_ENABLED).toBe(true);
    expect(cfg.ENABLE_FAILURE_ENDPOINTS).toBe(true);
  });

  it.each(['false', '0', 'no', 'off', ''])('treats %j as boolean false', (value) => {
    const cfg = parseConfig(apiConfigSchema, { ...baseApiEnv, REDIS_TLS_ENABLED: value });
    expect(cfg.REDIS_TLS_ENABLED).toBe(false);
  });

  it('requires DATABASE_URL', () => {
    expect(() => parseConfig(apiConfigSchema, { JWT_SECRET: baseApiEnv.JWT_SECRET })).toThrow(
      ConfigValidationError,
    );
  });

  it('rejects a too-short JWT_SECRET', () => {
    expect(() =>
      parseConfig(apiConfigSchema, { ...baseApiEnv, JWT_SECRET: 'short' }),
    ).toThrow(ConfigValidationError);
  });

  it('requires AWS vars in production', () => {
    try {
      parseConfig(apiConfigSchema, { ...baseApiEnv, NODE_ENV: 'production' });
      throw new Error('expected validation to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const paths = (err as ConfigValidationError).issues.map((i) => i.path.join('.'));
      expect(paths).toEqual(
        expect.arrayContaining(['AWS_REGION', 'EXPORT_QUEUE_URL', 'EXPORT_BUCKET_NAME']),
      );
    }
  });

  it('rejects failure endpoints enabled in production', () => {
    try {
      parseConfig(apiConfigSchema, {
        ...baseApiEnv,
        NODE_ENV: 'production',
        AWS_REGION: 'ap-southeast-1',
        EXPORT_QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/1/q',
        EXPORT_BUCKET_NAME: 'bucket',
        ENABLE_FAILURE_ENDPOINTS: 'true',
      });
      throw new Error('expected validation to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const paths = (err as ConfigValidationError).issues.map((i) => i.path.join('.'));
      expect(paths).toContain('ENABLE_FAILURE_ENDPOINTS');
    }
  });

  it('accepts a complete production config', () => {
    const cfg = parseConfig(apiConfigSchema, {
      ...baseApiEnv,
      NODE_ENV: 'production',
      AWS_REGION: 'ap-southeast-1',
      EXPORT_QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/1/q',
      EXPORT_BUCKET_NAME: 'bucket',
    });
    expect(cfg.NODE_ENV).toBe('production');
  });
});

describe('workerConfigSchema', () => {
  it('applies SQS defaults', () => {
    const cfg = parseConfig(workerConfigSchema, { ...baseWorkerEnv });
    expect(cfg.SQS_WAIT_TIME_SECONDS).toBe(20);
    expect(cfg.SQS_VISIBILITY_TIMEOUT_SECONDS).toBe(60);
  });

  it('rejects a wait time above the SQS max of 20', () => {
    expect(() =>
      parseConfig(workerConfigSchema, { ...baseWorkerEnv, SQS_WAIT_TIME_SECONDS: '25' }),
    ).toThrow(ConfigValidationError);
  });

  it('requires AWS vars in production', () => {
    expect(() =>
      parseConfig(workerConfigSchema, { ...baseWorkerEnv, NODE_ENV: 'production' }),
    ).toThrow(ConfigValidationError);
  });
});

describe('parseConfig', () => {
  it('aggregates all issues into one error message', () => {
    try {
      parseConfig(apiConfigSchema, {});
      throw new Error('expected validation to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const message = (err as ConfigValidationError).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('JWT_SECRET');
      expect((err as ConfigValidationError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});
