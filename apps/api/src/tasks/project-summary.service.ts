import { ProjectSummary } from '@cloudtask/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Task } from './task.entity';
import { RedisService } from '../redis/redis.service';

/**
 * Computes per-project task summaries with a 60s Redis cache (spec §6.4).
 * If Redis is unavailable the value is computed straight from Postgres — the
 * RedisService already degrades gracefully, so no special handling is needed.
 */
@Injectable()
export class ProjectSummaryService {
  private static readonly TTL_SECONDS = 60;
  private readonly logger = new Logger(ProjectSummaryService.name);

  constructor(
    @InjectRepository(Task)
    private readonly repo: Repository<Task>,
    private readonly redis: RedisService,
  ) {}

  async get(userId: string, projectId: string): Promise<ProjectSummary> {
    const key = ProjectSummaryService.cacheKey(userId, projectId);

    const cached = await this.redis.get(key);
    if (cached) {
      try {
        return JSON.parse(cached) as ProjectSummary;
      } catch {
        this.logger.warn(`Discarding malformed cached summary for ${key}`);
      }
    }

    const summary = await this.compute(userId, projectId);
    await this.redis.set(key, JSON.stringify(summary), ProjectSummaryService.TTL_SECONDS);
    return summary;
  }

  /** Drops the cached summary; called after any task mutation. */
  async invalidate(userId: string, projectId: string): Promise<void> {
    await this.redis.del(ProjectSummaryService.cacheKey(userId, projectId));
  }

  private async compute(userId: string, projectId: string): Promise<ProjectSummary> {
    const rows = await this.repo
      .createQueryBuilder('task')
      .select('task.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('task.ownerId = :userId', { userId })
      .andWhere('task.projectId = :projectId', { projectId })
      .groupBy('task.status')
      .getRawMany<{ status: string; count: string }>();

    const counts: Record<string, number> = { todo: 0, in_progress: 0, done: 0 };
    for (const row of rows) {
      counts[row.status] = Number(row.count);
    }
    const todo = counts.todo ?? 0;
    const inProgress = counts.in_progress ?? 0;
    const done = counts.done ?? 0;

    return {
      projectId,
      total: todo + inProgress + done,
      todo,
      inProgress,
      done,
      generatedAt: new Date().toISOString(),
    };
  }

  private static cacheKey(userId: string, projectId: string): string {
    return `project-summary:${userId}:${projectId}`;
  }
}
