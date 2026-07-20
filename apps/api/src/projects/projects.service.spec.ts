import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { Project } from './project.entity';
import { ProjectsService } from './projects.service';

function makeProject(overrides: Partial<Project> = {}): Project {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'proj-1',
    ownerId: 'user-1',
    name: 'Project One',
    description: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface RepoMock {
  create: jest.Mock;
  save: jest.Mock;
  find: jest.Mock;
  findOne: jest.Mock;
  remove: jest.Mock;
}

describe('ProjectsService', () => {
  let service: ProjectsService;
  let repo: RepoMock;

  beforeEach(() => {
    repo = {
      create: jest.fn((x: unknown) => x as Project),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
    };
    service = new ProjectsService(repo as unknown as Repository<Project>);
  });

  it('creates a project owned by the caller and serializes timestamps as ISO strings', async () => {
    repo.save.mockResolvedValue(makeProject({ description: 'desc' }));

    const result = await service.create('user-1', { name: 'Project One', description: 'desc' });

    expect(repo.create).toHaveBeenCalledWith({
      ownerId: 'user-1',
      name: 'Project One',
      description: 'desc',
    });
    expect(result).toEqual({
      id: 'proj-1',
      ownerId: 'user-1',
      name: 'Project One',
      description: 'desc',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('defaults a missing description to null', async () => {
    repo.save.mockResolvedValue(makeProject());
    const result = await service.create('user-1', { name: 'Project One' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: null }),
    );
    expect(result.description).toBeNull();
  });

  it('lists only the caller-owned projects, newest first', async () => {
    repo.find.mockResolvedValue([makeProject()]);
    await service.list('user-1');
    expect(repo.find).toHaveBeenCalledWith({
      where: { ownerId: 'user-1' },
      order: { createdAt: 'DESC' },
    });
  });

  it('scopes getOne by owner and throws 404 when not found', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.getOne('user-1', 'proj-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'proj-x', ownerId: 'user-1' } });
  });

  it('updates only the provided fields', async () => {
    const existing = makeProject({ name: 'Old', description: 'old' });
    repo.findOne.mockResolvedValue(existing);
    repo.save.mockImplementation(async (p) => p as Project);

    await service.update('user-1', 'proj-1', { name: 'New' });

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New', description: 'old' }),
    );
  });

  it('update throws 404 for a project the caller does not own', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.update('user-1', 'proj-x', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('removes an owned project and 404s otherwise', async () => {
    const existing = makeProject();
    repo.findOne.mockResolvedValueOnce(existing);
    await service.remove('user-1', 'proj-1');
    expect(repo.remove).toHaveBeenCalledWith(existing);

    repo.findOne.mockResolvedValueOnce(null);
    await expect(service.remove('user-1', 'proj-x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
