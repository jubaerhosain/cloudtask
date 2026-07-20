import { CreateExportResponse, ExportMessage, ExportResponse } from '@cloudtask/contracts';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ExportJob } from './export.entity';
import { EXPORT_DOWNLOADS, EXPORT_QUEUE, ExportDownloadUrls, ExportQueuePublisher } from './ports';
import { assertFound } from '../common/ownership/ownership.util';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    @InjectRepository(ExportJob)
    private readonly repo: Repository<ExportJob>,
    private readonly projects: ProjectsService,
    @Inject(EXPORT_QUEUE) private readonly queue: ExportQueuePublisher,
    @Inject(EXPORT_DOWNLOADS) private readonly downloads: ExportDownloadUrls,
  ) {}

  /**
   * Creates a queued export record and enqueues the job. If enqueueing fails,
   * the record is marked failed and a controlled 503 is returned — the request
   * never falsely reports success (spec §23).
   */
  async requestExport(userId: string, projectId: string): Promise<CreateExportResponse> {
    await this.projects.getOne(userId, projectId); // 404 if not owned

    const job = await this.repo.save(
      this.repo.create({
        projectId,
        userId,
        status: 'queued',
        attemptCount: 0,
        requestedAt: new Date(),
      }),
    );

    const message: ExportMessage = {
      schemaVersion: 1,
      exportId: job.id,
      projectId,
      userId,
      requestedAt: job.requestedAt.toISOString(),
    };

    try {
      await this.queue.publish(message);
    } catch (err) {
      job.status = 'failed';
      job.errorCode = 'queue_unavailable';
      job.errorMessage = (err as Error).message;
      await this.repo.save(job);
      this.logger.error(`Failed to enqueue export ${job.id}: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Failed to enqueue export');
    }

    return { exportId: job.id, status: 'queued' };
  }

  async getExport(userId: string, id: string): Promise<ExportResponse> {
    const job = assertFound(
      await this.repo.findOne({ where: { id, userId } }),
      'Export not found',
    );

    let downloadUrl: string | null = null;
    if (job.status === 'completed' && job.s3Bucket && job.s3Key) {
      downloadUrl = await this.downloads.getDownloadUrl(job.s3Bucket, job.s3Key);
    }

    return {
      id: job.id,
      projectId: job.projectId,
      status: job.status,
      requestedAt: job.requestedAt.toISOString(),
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      downloadUrl,
      errorCode: job.errorCode,
    };
  }
}
