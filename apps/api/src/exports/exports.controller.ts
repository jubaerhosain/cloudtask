import { CreateExportResponse, ExportResponse } from '@cloudtask/contracts';
import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ExportsService } from './exports.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types';
import { RateLimit } from '../ratelimit/rate-limit.decorator';

@ApiTags('exports')
@ApiBearerAuth()
@RateLimit({ name: 'api', limit: 120, windowSec: 60, keyBy: 'user' })
@Controller()
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Post('projects/:projectId/exports')
  @HttpCode(HttpStatus.ACCEPTED)
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<CreateExportResponse> {
    return this.exports.requestExport(user.userId, projectId);
  }

  @Get('exports/:id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ExportResponse> {
    return this.exports.getExport(user.userId, id);
  }
}
