import request from 'supertest';

import { createTestApp, TestContext } from './utils/test-app';

async function registerAndLogin(
  http: ReturnType<typeof request>,
  email: string,
): Promise<string> {
  await http.post('/api/v1/auth/register').send({ email, password: 'password-1234', displayName: email });
  const res = await http.post('/api/v1/auth/login').send({ email, password: 'password-1234' });
  return res.body.accessToken;
}

describe('Tasks + summary (e2e)', () => {
  let ctx: TestContext;
  let http: ReturnType<typeof request>;
  let tokenA: string;
  let tokenB: string;
  let projectId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
    tokenA = await registerAndLogin(http, 'tasks-a@example.com');
    tokenB = await registerAndLogin(http, 'tasks-b@example.com');
    const res = await http.post('/api/v1/projects').set(auth(tokenA)).send({ name: 'Board' });
    projectId = res.body.id;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  describe('create + validation + ownership', () => {
    it('creates a task with defaults (status=todo, priority=medium)', async () => {
      const res = await http
        .post(`/api/v1/projects/${projectId}/tasks`)
        .set(auth(tokenA))
        .send({ title: 'First task' })
        .expect(201);
      expect(res.body).toMatchObject({
        title: 'First task',
        status: 'todo',
        priority: 'medium',
        projectId,
      });
    });

    it('rejects an invalid status with 400', async () => {
      const res = await http
        .post(`/api/v1/projects/${projectId}/tasks`)
        .set(auth(tokenA))
        .send({ title: 'Bad', status: 'nope' })
        .expect(400);
      expect(res.body).toMatchObject({ status: 400, title: 'Bad Request' });
    });

    it('cannot create a task under another user’s project (404)', async () => {
      await http
        .post(`/api/v1/projects/${projectId}/tasks`)
        .set(auth(tokenB))
        .send({ title: 'Sneaky' })
        .expect(404);
    });
  });

  describe('list filters + pagination', () => {
    beforeAll(async () => {
      // Seed a known set for filtering.
      const make = (body: Record<string, unknown>) =>
        http.post(`/api/v1/projects/${projectId}/tasks`).set(auth(tokenA)).send(body);
      await make({ title: 'high-done', status: 'done', priority: 'high', dueDate: '2026-03-01' });
      await make({ title: 'low-todo', status: 'todo', priority: 'low', dueDate: '2026-05-01' });
      await make({ title: 'searchable widget', status: 'in_progress', priority: 'medium' });
    });

    it('filters by status', async () => {
      const res = await http
        .get(`/api/v1/projects/${projectId}/tasks?status=done`)
        .set(auth(tokenA))
        .expect(200);
      expect(res.body.items.every((t: { status: string }) => t.status === 'done')).toBe(true);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by priority', async () => {
      const res = await http
        .get(`/api/v1/projects/${projectId}/tasks?priority=low`)
        .set(auth(tokenA))
        .expect(200);
      expect(res.body.items.every((t: { priority: string }) => t.priority === 'low')).toBe(true);
    });

    it('filters by title search', async () => {
      const res = await http
        .get(`/api/v1/projects/${projectId}/tasks?search=widget`)
        .set(auth(tokenA))
        .expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].title).toBe('searchable widget');
    });

    it('filters by due-date range', async () => {
      const res = await http
        .get(`/api/v1/projects/${projectId}/tasks?dueFrom=2026-04-01&dueTo=2026-06-01`)
        .set(auth(tokenA))
        .expect(200);
      expect(res.body.items.every((t: { dueDate: string | null }) => t.dueDate === '2026-05-01')).toBe(
        true,
      );
    });

    it('paginates with page/limit and reports total', async () => {
      const res = await http
        .get(`/api/v1/projects/${projectId}/tasks?page=1&limit=2`)
        .set(auth(tokenA))
        .expect(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.limit).toBe(2);
      expect(res.body.total).toBeGreaterThanOrEqual(4);
    });

    it('rejects limit above the max of 100 (400)', async () => {
      await http
        .get(`/api/v1/projects/${projectId}/tasks?limit=500`)
        .set(auth(tokenA))
        .expect(400);
    });
  });

  describe('single-task get/patch/delete + ownership', () => {
    let taskId: string;

    beforeAll(async () => {
      const res = await http
        .post(`/api/v1/projects/${projectId}/tasks`)
        .set(auth(tokenA))
        .send({ title: 'lifecycle' });
      taskId = res.body.id;
    });

    it('gets by id for the owner and 404s for others', async () => {
      await http.get(`/api/v1/tasks/${taskId}`).set(auth(tokenA)).expect(200);
      await http.get(`/api/v1/tasks/${taskId}`).set(auth(tokenB)).expect(404);
    });

    it('patches status for the owner, 404 for others', async () => {
      const res = await http
        .patch(`/api/v1/tasks/${taskId}`)
        .set(auth(tokenA))
        .send({ status: 'in_progress' })
        .expect(200);
      expect(res.body.status).toBe('in_progress');
      await http.patch(`/api/v1/tasks/${taskId}`).set(auth(tokenB)).send({ status: 'done' }).expect(404);
    });

    it('deletes for the owner (204) then 404 afterwards', async () => {
      await http.delete(`/api/v1/tasks/${taskId}`).set(auth(tokenA)).expect(204);
      await http.get(`/api/v1/tasks/${taskId}`).set(auth(tokenA)).expect(404);
    });
  });

  describe('project summary + cache invalidation', () => {
    let summaryProjectId: string;

    beforeAll(async () => {
      const res = await http.post('/api/v1/projects').set(auth(tokenA)).send({ name: 'Summary board' });
      summaryProjectId = res.body.id;
    });

    it('returns zeroed counts for an empty project', async () => {
      const res = await http
        .get(`/api/v1/projects/${summaryProjectId}/summary`)
        .set(auth(tokenA))
        .expect(200);
      expect(res.body).toMatchObject({
        projectId: summaryProjectId,
        total: 0,
        todo: 0,
        inProgress: 0,
        done: 0,
      });
      expect(res.body.generatedAt).toEqual(expect.any(String));
    });

    it('reflects new tasks after cache invalidation on create', async () => {
      await http
        .post(`/api/v1/projects/${summaryProjectId}/tasks`)
        .set(auth(tokenA))
        .send({ title: 't1', status: 'todo' });
      await http
        .post(`/api/v1/projects/${summaryProjectId}/tasks`)
        .set(auth(tokenA))
        .send({ title: 't2', status: 'done' });

      const res = await http
        .get(`/api/v1/projects/${summaryProjectId}/summary`)
        .set(auth(tokenA))
        .expect(200);
      expect(res.body).toMatchObject({ total: 2, todo: 1, done: 1, inProgress: 0 });
    });

    it('404s the summary for a non-owner', async () => {
      await http.get(`/api/v1/projects/${summaryProjectId}/summary`).set(auth(tokenB)).expect(404);
    });
  });
});
