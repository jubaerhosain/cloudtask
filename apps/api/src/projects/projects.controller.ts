import { ProjectResponse } from '@cloudtask/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types';
import { RateLimit } from '../ratelimit/rate-limit.decorator';

@ApiTags('projects')
@ApiBearerAuth()
// Authenticated API limit: 120 requests/min per user (spec §6.6).
@RateLimit({ name: 'api', limit: 120, windowSec: 60, keyBy: 'user' })
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectResponse> {
    return this.projects.create(user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<ProjectResponse[]> {
    return this.projects.list(user.userId);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectResponse> {
    return this.projects.getOne(user.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectResponse> {
    return this.projects.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.projects.remove(user.userId, id);
  }
}
