import { ProjectSummary, TaskListResponse, TaskResponse } from '@cloudtask/contracts';
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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CreateTaskDto } from './dto/create-task.dto';
import { TaskListQueryDto } from './dto/task-list-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types';
import { RateLimit } from '../ratelimit/rate-limit.decorator';

@ApiTags('tasks')
@ApiBearerAuth()
@RateLimit({ name: 'api', limit: 120, windowSec: 60, keyBy: 'user' })
@Controller()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post('projects/:projectId/tasks')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskResponse> {
    return this.tasks.create(user.userId, projectId, dto);
  }

  @Get('projects/:projectId/tasks')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: TaskListQueryDto,
  ): Promise<TaskListResponse> {
    return this.tasks.list(user.userId, projectId, query);
  }

  @Get('projects/:projectId/summary')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectSummary> {
    return this.tasks.getSummary(user.userId, projectId);
  }

  @Get('tasks/:id')
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskResponse> {
    return this.tasks.getById(user.userId, id);
  }

  @Patch('tasks/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskResponse> {
    return this.tasks.update(user.userId, id, dto);
  }

  @Delete('tasks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.tasks.remove(user.userId, id);
  }
}
