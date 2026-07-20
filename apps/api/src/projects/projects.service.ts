import { CreateProjectRequest, ProjectResponse, UpdateProjectRequest } from '@cloudtask/contracts';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Project } from './project.entity';
import { assertFound } from '../common/ownership/ownership.util';

/**
 * All methods take the authenticated userId and scope every query by ownerId,
 * so a project owned by another user is simply "not found" (404), never leaked.
 */
@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly repo: Repository<Project>,
  ) {}

  async create(userId: string, dto: CreateProjectRequest): Promise<ProjectResponse> {
    const project = await this.repo.save(
      this.repo.create({
        ownerId: userId,
        name: dto.name,
        description: dto.description ?? null,
      }),
    );
    return toResponse(project);
  }

  async list(userId: string): Promise<ProjectResponse[]> {
    const projects = await this.repo.find({
      where: { ownerId: userId },
      order: { createdAt: 'DESC' },
    });
    return projects.map(toResponse);
  }

  async getOne(userId: string, id: string): Promise<ProjectResponse> {
    return toResponse(await this.findOwned(userId, id));
  }

  async update(userId: string, id: string, dto: UpdateProjectRequest): Promise<ProjectResponse> {
    const project = await this.findOwned(userId, id);
    if (dto.name !== undefined) project.name = dto.name;
    if (dto.description !== undefined) project.description = dto.description ?? null;
    return toResponse(await this.repo.save(project));
  }

  async remove(userId: string, id: string): Promise<void> {
    const project = await this.findOwned(userId, id);
    await this.repo.remove(project);
  }

  /** Loads a project scoped to its owner, or throws 404. */
  private async findOwned(userId: string, id: string): Promise<Project> {
    const project = await this.repo.findOne({ where: { id, ownerId: userId } });
    return assertFound(project, 'Project not found');
  }
}

function toResponse(project: Project): ProjectResponse {
  return {
    id: project.id,
    ownerId: project.ownerId,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}
