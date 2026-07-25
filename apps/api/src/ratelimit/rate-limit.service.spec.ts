import { RateLimitService } from './rate-limit.service';
import { RedisService } from '../redis/redis.service';

function mockRedis(opts: { available: boolean; eval?: jest.Mock }): RedisService {
  return {
    isAvailable: () => opts.available,
    raw: { eval: opts.eval ?? jest.fn() },
  } as unknown as RedisService;
}

describe('RateLimitService', () => {
  it('uses the in-memory limiter when Redis is unavailable', async () => {
    const evalFn = jest.fn();
    const service = new RateLimitService(mockRedis({ available: false, eval: evalFn }));

    const result = await service.consume('key', 2, 60);

    expect(result.allowed).toBe(true);
    expect(evalFn).not.toHaveBeenCalled();
  });

  it('uses Redis when available', async () => {
    const evalFn = jest.fn().mockResolvedValue([1, 60_000]);
    const service = new RateLimitService(mockRedis({ available: true, eval: evalFn }));

    const result = await service.consume('key', 5, 60);

    expect(evalFn).toHaveBeenCalled();
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('falls back to memory (never throws) when a Redis call fails mid-flight', async () => {
    const evalFn = jest.fn().mockRejectedValue(new Error('connection reset'));
    const service = new RateLimitService(mockRedis({ available: true, eval: evalFn }));

    const result = await service.consume('key', 5, 60);

    expect(evalFn).toHaveBeenCalled();
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });
});
