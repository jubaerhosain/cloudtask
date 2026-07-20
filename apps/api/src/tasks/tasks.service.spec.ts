import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { ProjectSummaryService } from './project-summary.service';
import { Task } from './task.entity';
import { TasksService } from './tasks.service';
import { ProjectsService } from '../projects/projects.service';

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'task-1',
    projectId: 'proj-1',
    ownerId: 'user-1',
    title: 'Task One',
    description: null,
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('TasksService', () => {
  let repo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock; remove: jest.Mock };
  let projects: { getOne: jest.Mock };
  let summary: { invalidate: jest.Mock; get: jest.Mock };
  let service: TasksService;

  beforeEach(() => {
    repo = {
      create: jest.fn((x: unknown) => x as Task),
      save: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
    };
    projects = { getOne: jest.fn().mockResolvedValue({ id: 'proj-1' }) };
    summary = { invalidate: jest.fn(), get: jest.fn() };
    service = new TasksService(
      repo as unknown as Repository<Task>,
      projects as unknown as ProjectsService,
      summary as unknown as ProjectSummaryService,
    );
  });

  it('creates a task under an owned project and invalidates the summary cache', async () => {
    repo.save.mockResolvedValue(makeTask({ status: 'todo', priority: 'high' }));

    const result = await service.create('user-1', 'proj-1', {
      title: 'Task One',
      status: 'todo',
      priority: 'high',
    });

    expect(projects.getOne).toHaveBeenCalledWith('user-1', 'proj-1');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1', ownerId: 'user-1', title: 'Task One' }),
    );
    expect(summary.invalidate).toHaveBeenCalledWith('user-1', 'proj-1');
    expect(result.status).toBe('todo');
  });

  it('does not create a task when the project is not owned (propagates 404)', async () => {
    projects.getOne.mockRejectedValue(new NotFoundException('Project not found'));

    await expect(
      service.create('user-1', 'proj-x', { title: 'x', status: 'todo', priority: 'low' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.save).not.toHaveBeenCalled();
    expect(summary.invalidate).not.toHaveBeenCalled();
  });

  it('getById throws 404 for a task the caller does not own', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.getById('user-1', 'task-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'task-x', ownerId: 'user-1' } });
  });

  it('updates only provided fields and invalidates the summary', async () => {
    repo.findOne.mockResolvedValue(makeTask({ title: 'Old', status: 'todo' }));
    repo.save.mockImplementation(async (t) => t as Task);

    await service.update('user-1', 'task-1', { status: 'done' });

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Old', status: 'done' }),
    );
    expect(summary.invalidate).toHaveBeenCalledWith('user-1', 'proj-1');
  });

  it('removes an owned task and invalidates the summary', async () => {
    repo.findOne.mockResolvedValue(makeTask());
    await service.remove('user-1', 'task-1');
    expect(repo.remove).toHaveBeenCalled();
    expect(summary.invalidate).toHaveBeenCalledWith('user-1', 'proj-1');
  });
});
