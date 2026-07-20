import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createTestApp, TestContext } from './utils/test-app';

describe('Auth (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const validUser = {
    email: 'Alice@Example.com',
    password: 'super-secret-pw',
    displayName: 'Alice',
  };

  describe('operational endpoints', () => {
    it('GET /health returns 200 and is outside the /api/v1 prefix', async () => {
      await http.get('/health').expect(200, { status: 'ok' });
      await http.get('/api/v1/health').expect(404);
    });

    it('GET /ready reports both dependencies up', async () => {
      const res = await http.get('/ready').expect(200);
      expect(res.body).toEqual({ status: 'ok', checks: { postgres: 'up', redis: 'up' } });
    });
  });

  describe('POST /api/v1/auth/register', () => {
    it('creates a user (201), lowercases the email, and never returns the hash', async () => {
      const res = await http.post('/api/v1/auth/register').send(validUser).expect(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        email: 'alice@example.com',
        displayName: 'Alice',
      });
      expect(JSON.stringify(res.body)).not.toContain(validUser.password);
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('rejects a duplicate email case-insensitively with 409 (proves lower(email) index)', async () => {
      const res = await http
        .post('/api/v1/auth/register')
        .send({ ...validUser, email: 'ALICE@example.com' })
        .expect(409);
      expect(res.body).toMatchObject({ status: 409, title: 'Conflict' });
    });

    it('rejects a short password with a 400 problem-details payload', async () => {
      const res = await http
        .post('/api/v1/auth/register')
        .send({ email: 'bob@example.com', password: 'short', displayName: 'Bob' })
        .expect(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({ status: 400, title: 'Bad Request' });
      expect(res.body.errors.map((e: { path: string }) => e.path)).toContain('password');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns an access token and expiresIn=3600 for valid credentials', async () => {
      const res = await http
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: validUser.password })
        .expect(200);
      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        expiresIn: 3600,
        user: { email: 'alice@example.com', displayName: 'Alice' },
      });
      expect(JSON.stringify(res.body)).not.toContain(validUser.password);
    });

    it('returns a generic 401 for a wrong password', async () => {
      const res = await http
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: 'wrong-password' })
        .expect(401);
      expect(res.body).toMatchObject({ status: 401, detail: 'Invalid email or password' });
    });

    it('returns the same generic 401 for an unknown user (no enumeration)', async () => {
      const res = await http
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever-here' })
        .expect(401);
      expect(res.body.detail).toBe('Invalid email or password');
    });
  });

  describe('JWT guard on GET /api/v1/auth/me', () => {
    let token: string;

    beforeAll(async () => {
      const res = await http
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: validUser.password });
      token = res.body.accessToken;
    });

    it('rejects a request with no token (401 problem-details)', async () => {
      const res = await http.get('/api/v1/auth/me').expect(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
    });

    it('accepts a valid bearer token and returns the profile', async () => {
      const res = await http
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({ email: 'alice@example.com', displayName: 'Alice' });
    });
  });

  describe('request id + rate limiting', () => {
    it('echoes a valid incoming x-request-id header', async () => {
      const res = await http.get('/health').set('x-request-id', 'req-abc-123').expect(200);
      expect(res.headers['x-request-id']).toBe('req-abc-123');
    });

    it('limits login to 10 attempts per IP and then returns 429 with Retry-After', async () => {
      const attempt = () =>
        http
          .post('/api/v1/auth/login')
          .set('x-forwarded-for', '203.0.113.9')
          .send({ email: 'ratelimit@example.com', password: 'whatever-here' });

      let sawTooMany = false;
      let retryAfter: string | undefined;
      for (let i = 0; i < 12; i += 1) {
        const res = await attempt();
        if (res.status === 429) {
          sawTooMany = true;
          retryAfter = res.headers['retry-after'];
          break;
        }
      }
      expect(sawTooMany).toBe(true);
      expect(retryAfter).toBeDefined();
    });
  });
});
