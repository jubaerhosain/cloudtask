import {
  CreateTaskRequest,
  ProjectSummary,
  TaskListQuery,
  TaskListResponse,
  TaskResponse,
  UpdateTaskRequest,
} from '@cloudtask/contracts';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ProjectSummaryService } from './project-summary.service';
import { Task } from './task.entity';
import { assertFound } from '../common/ownership/ownership.util';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly repo: Repository<Task>,
    private readonly projects: ProjectsService,
    private readonly summary: ProjectSummaryService,
  ) {}

  async create(userId: string, projectId: string, dto: CreateTaskRequest): Promise<TaskResponse> {
    await this.projects.getOne(userId, projectId); // 404 if project not owned
    const task = await this.repo.save(
      this.repo.create({
        projectId,
        ownerId: userId,
        title: dto.title,
        description: dto.description ?? null,
        status: dto.status,
        priority: dto.priority,
        dueDate: dto.dueDate ?? null,
      }),
    );
    await this.summary.invalidate(userId, projectId);
    return toResponse(task);
  }

  async list(
    userId: string,
    projectId: string,
    query: TaskListQuery,
  ): Promise<TaskListResponse> {
    await this.projects.getOne(userId, projectId);

    const qb = this.repo
      .createQueryBuilder('task')
      .where('task.ownerId = :userId', { userId })
      .andWhere('task.projectId = :projectId', { projectId });

    if (query.status) qb.andWhere('task.status = :status', { status: query.status });
    if (query.priority) qb.andWhere('task.priority = :priority', { priority: query.priority });
    if (query.dueFrom) qb.andWhere('task.dueDate >= :dueFrom', { dueFrom: query.dueFrom });
    if (query.dueTo) qb.andWhere('task.dueDate <= :dueTo', { dueTo: query.dueTo });
    if (query.search) qb.andWhere('task.title ILIKE :search', { search: `%${query.search}%` });

    qb.orderBy('task.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [items, total] = await qb.getManyAndCount();
    return { items: items.map(toResponse), total, page: query.page, limit: query.limit };
  }

  async getById(userId: string, id: string): Promise<TaskResponse> {
    return toResponse(await this.findOwned(userId, id));
  }

  async update(userId: string, id: string, dto: UpdateTaskRequest): Promise<TaskResponse> {
    const task = await this.findOwned(userId, id);
    if (dto.title !== undefined) task.title = dto.title;
    if (dto.description !== undefined) task.description = dto.description ?? null;
    if (dto.status !== undefined) task.status = dto.status;
    if (dto.priority !== undefined) task.priority = dto.priority;
    if (dto.dueDate !== undefined) task.dueDate = dto.dueDate ?? null;

    const saved = await this.repo.save(task);
    await this.summary.invalidate(userId, task.projectId);
    return toResponse(saved);
  }

  async remove(userId: string, id: string): Promise<void> {
    const task = await this.findOwned(userId, id);
    const projectId = task.projectId;
    await this.repo.remove(task);
    await this.summary.invalidate(userId, projectId);
  }

  async getSummary(userId: string, projectId: string): Promise<ProjectSummary> {
    await this.projects.getOne(userId, projectId);
    return this.summary.get(userId, projectId);
  }

  private async findOwned(userId: string, id: string): Promise<Task> {
    const task = await this.repo.findOne({ where: { id, ownerId: userId } });
    return assertFound(task, 'Task not found');
  }
}

function toResponse(task: Task): TaskResponse {
  return {
    id: task.id,
    projectId: task.projectId,
    ownerId: task.ownerId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}
