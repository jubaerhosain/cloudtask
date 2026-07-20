import request from 'supertest';

import { createTestApp, TestContext } from './utils/test-app';

/** Registers a user and returns their bearer token. */
async function registerAndLogin(
  http: ReturnType<typeof request>,
  email: string,
): Promise<string> {
  await http.post('/api/v1/auth/register').send({ email, password: 'password-1234', displayName: email });
  const res = await http.post('/api/v1/auth/login').send({ email, password: 'password-1234' });
  return res.body.accessToken;
}

describe('Projects (e2e)', () => {
  let ctx: TestContext;
  let http: ReturnType<typeof request>;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
    tokenA = await registerAndLogin(http, 'owner-a@example.com');
    tokenB = await registerAndLogin(http, 'owner-b@example.com');
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('requires authentication', async () => {
    await http.get('/api/v1/projects').expect(401);
  });

  it('rejects an invalid project id with 400', async () => {
    await http.get('/api/v1/projects/not-a-uuid').set(auth(tokenA)).expect(400);
  });

  it('rejects an empty name with 400 problem-details', async () => {
    const res = await http
      .post('/api/v1/projects')
      .set(auth(tokenA))
      .send({ name: '' })
      .expect(400);
    expect(res.body).toMatchObject({ status: 400, title: 'Bad Request' });
  });

  describe('CRUD + ownership isolation', () => {
    let projectId: string;

    it('creates a project owned by A (201)', async () => {
      const res = await http
        .post('/api/v1/projects')
        .set(auth(tokenA))
        .send({ name: 'Alpha', description: 'first' })
        .expect(201);
      expect(res.body).toMatchObject({ name: 'Alpha', description: 'first' });
      expect(res.body.id).toEqual(expect.any(String));
      projectId = res.body.id;
    });

    it('lists A’s projects', async () => {
      const res = await http.get('/api/v1/projects').set(auth(tokenA)).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(projectId);
    });

    it('does not list A’s project for B', async () => {
      const res = await http.get('/api/v1/projects').set(auth(tokenB)).expect(200);
      expect(res.body).toHaveLength(0);
    });

    it('lets A read the project (200) but returns 404 to B (no enumeration)', async () => {
      await http.get(`/api/v1/projects/${projectId}`).set(auth(tokenA)).expect(200);
      await http.get(`/api/v1/projects/${projectId}`).set(auth(tokenB)).expect(404);
    });

    it('lets A patch, but 404s for B', async () => {
      const res = await http
        .patch(`/api/v1/projects/${projectId}`)
        .set(auth(tokenA))
        .send({ description: 'updated' })
        .expect(200);
      expect(res.body.description).toBe('updated');
      expect(res.body.name).toBe('Alpha');

      await http
        .patch(`/api/v1/projects/${projectId}`)
        .set(auth(tokenB))
        .send({ name: 'hijack' })
        .expect(404);
    });

    it('404s when B tries to delete, 204 when A deletes, then 404 afterwards', async () => {
      await http.delete(`/api/v1/projects/${projectId}`).set(auth(tokenB)).expect(404);
      await http.delete(`/api/v1/projects/${projectId}`).set(auth(tokenA)).expect(204);
      await http.get(`/api/v1/projects/${projectId}`).set(auth(tokenA)).expect(404);
    });
  });
});
