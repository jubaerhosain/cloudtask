import { MemoryRateLimiter } from './memory-rate-limiter';

describe('MemoryRateLimiter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('allows requests up to the limit, then blocks', async () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 1; i <= 10; i += 1) {
      const result = await limiter.consume('key', 10, 300);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10 - i);
    }
    const blocked = await limiter.consume('key', 10, 300);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('tracks separate keys independently', async () => {
    const limiter = new MemoryRateLimiter();
    await limiter.consume('a', 1, 300);
    const a = await limiter.consume('a', 1, 300);
    const b = await limiter.consume('b', 1, 300);
    expect(a.allowed).toBe(false);
    expect(b.allowed).toBe(true);
  });

  it('resets after the window elapses', async () => {
    const limiter = new MemoryRateLimiter();
    const start = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(start);

    await limiter.consume('key', 1, 300);
    expect((await limiter.consume('key', 1, 300)).allowed).toBe(false);

    nowSpy.mockReturnValue(start + 300_000 + 1);
    expect((await limiter.consume('key', 1, 300)).allowed).toBe(true);
  });
});
