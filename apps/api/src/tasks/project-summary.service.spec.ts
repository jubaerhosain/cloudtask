import { Repository } from 'typeorm';

import { ProjectSummaryService } from './project-summary.service';
import { Task } from './task.entity';
import { RedisService } from '../redis/redis.service';

function mockQueryBuilder(rows: { status: string; count: string }[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const method of ['select', 'addSelect', 'where', 'andWhere', 'groupBy']) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue(rows);
  return qb;
}

describe('ProjectSummaryService', () => {
  const key = 'project-summary:user-1:proj-1';
  let repo: { createQueryBuilder: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let service: ProjectSummaryService;

  beforeEach(() => {
    repo = { createQueryBuilder: jest.fn() };
    redis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    service = new ProjectSummaryService(
      repo as unknown as Repository<Task>,
      redis as unknown as RedisService,
    );
  });

  it('returns the cached summary without querying Postgres on a cache hit', async () => {
    const cached = { projectId: 'proj-1', total: 5, todo: 2, inProgress: 2, done: 1, generatedAt: 'x' };
    redis.get.mockResolvedValue(JSON.stringify(cached));

    const result = await service.get('user-1', 'proj-1');

    expect(result).toEqual(cached);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    expect(redis.get).toHaveBeenCalledWith(key);
  });

  it('computes from Postgres and caches for 60s on a cache miss', async () => {
    redis.get.mockResolvedValue(null);
    repo.createQueryBuilder.mockReturnValue(
      mockQueryBuilder([
        { status: 'todo', count: '2' },
        { status: 'done', count: '3' },
      ]),
    );

    const result = await service.get('user-1', 'proj-1');

    expect(result).toMatchObject({ total: 5, todo: 2, inProgress: 0, done: 3, projectId: 'proj-1' });
    expect(result.generatedAt).toEqual(expect.any(String));
    expect(redis.set).toHaveBeenCalledWith(key, expect.any(String), 60);
  });

  it('recomputes when the cached value is malformed (fallback, never throws)', async () => {
    redis.get.mockResolvedValue('{not valid json');
    repo.createQueryBuilder.mockReturnValue(mockQueryBuilder([{ status: 'in_progress', count: '4' }]));

    const result = await service.get('user-1', 'proj-1');

    expect(result).toMatchObject({ total: 4, inProgress: 4, todo: 0, done: 0 });
  });

  it('invalidate deletes the cache key', async () => {
    await service.invalidate('user-1', 'proj-1');
    expect(redis.del).toHaveBeenCalledWith(key);
  });
});
