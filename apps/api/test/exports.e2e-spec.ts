import { ExportMessage } from '@cloudtask/contracts';
import request from 'supertest';

import { createTestApp, TestContext } from './utils/test-app';
import { EXPORT_DOWNLOADS, EXPORT_QUEUE } from '../src/exports/ports';

/** In-memory fake queue that records published messages and can be told to fail. */
class FakeQueue {
  readonly published: ExportMessage[] = [];
  failNext = false;
  async publish(message: ExportMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('SQS unavailable');
    }
    this.published.push(message);
  }
}

const fakeDownloads = { getDownloadUrl: async () => 'https://signed.example/download.csv' };

async function registerAndLogin(http: ReturnType<typeof request>, email: string): Promise<string> {
  await http.post('/api/v1/auth/register').send({ email, password: 'password-1234', displayName: email });
  const res = await http.post('/api/v1/auth/login').send({ email, password: 'password-1234' });
  return res.body.accessToken;
}

describe('Exports (e2e)', () => {
  let ctx: TestContext;
  let http: ReturnType<typeof request>;
  let queue: FakeQueue;
  let tokenA: string;
  let tokenB: string;
  let projectId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    queue = new FakeQueue();
    ctx = await createTestApp((builder) => {
      builder.overrideProvider(EXPORT_QUEUE).useValue(queue);
      builder.overrideProvider(EXPORT_DOWNLOADS).useValue(fakeDownloads);
    });
    http = request(ctx.app.getHttpServer());
    tokenA = await registerAndLogin(http, 'exp-a@example.com');
    tokenB = await registerAndLogin(http, 'exp-b@example.com');
    const res = await http.post('/api/v1/projects').set(auth(tokenA)).send({ name: 'Exportable' });
    projectId = res.body.id;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('requesting an export returns 202 with a queued status and publishes the envelope', async () => {
    const res = await http
      .post(`/api/v1/projects/${projectId}/exports`)
      .set(auth(tokenA))
      .expect(202);
    expect(res.body).toEqual({ exportId: expect.any(String), status: 'queued' });

    const message = queue.published.find((m) => m.exportId === res.body.exportId);
    expect(message).toMatchObject({ schemaVersion: 1, projectId });
    expect(message?.userId).toEqual(expect.any(String));
    expect(message?.requestedAt).toEqual(expect.any(String));
  });

  it('cannot request an export on another user’s project (404)', async () => {
    await http.post(`/api/v1/projects/${projectId}/exports`).set(auth(tokenB)).expect(404);
  });

  it('fetches export status; a fresh export is queued with no download URL', async () => {
    const created = await http.post(`/api/v1/projects/${projectId}/exports`).set(auth(tokenA));
    const res = await http.get(`/api/v1/exports/${created.body.exportId}`).set(auth(tokenA)).expect(200);
    expect(res.body).toMatchObject({ status: 'queued', downloadUrl: null, projectId });
  });

  it('does not leak another user’s export (404)', async () => {
    const created = await http.post(`/api/v1/projects/${projectId}/exports`).set(auth(tokenA));
    await http.get(`/api/v1/exports/${created.body.exportId}`).set(auth(tokenB)).expect(404);
  });

  it('returns a controlled 503 when the queue is unavailable (no false success)', async () => {
    queue.failNext = true;
    await http.post(`/api/v1/projects/${projectId}/exports`).set(auth(tokenA)).expect(503);
  });
});
