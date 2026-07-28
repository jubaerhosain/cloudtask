import { describe, expect, it } from 'vitest';

import { dynamic, GET } from './route';

describe('GET /healthz', () => {
  it('responds 200 so the ALB target group marks the task healthy', async () => {
    const res = GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  it('is not cached — a wedged process must not be masked by a stored 200', () => {
    expect(GET().headers.get('cache-control')).toBe('no-store');
  });

  it('opts out of static rendering', () => {
    // Without this, Next.js prerenders the handler at build time and the ALB
    // would be probing a static file instead of the running server.
    expect(dynamic).toBe('force-dynamic');
  });

  it('does no I/O, so liveness never fails on a slow dependency', () => {
    // Synchronous return is the contract: readiness/dependency checks live on
    // the api service (/ready), not here.
    expect(GET()).toBeInstanceOf(Response);
  });
});
