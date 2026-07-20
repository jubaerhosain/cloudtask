import { ExportMessage } from '@cloudtask/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { tasksToCsv } from './csv.util';
import { EXPORT_STORAGE, ExportStorage } from './ports';
import { Task } from '../database/entities/task.entity';
import { Logger, LOGGER } from '../logger/logger';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Processes a single export job. Idempotent via a conditional status claim:
 *
 *  - The claim UPDATE only matches rows whose status is not 'completed', so a
 *    redelivered message for an already-finished export is a no-op (§6.5).
 *  - S3 uses a deterministic key (exports/{userId}/{exportId}.csv), so a retry
 *    after a crash between upload and the DB write simply overwrites the same
 *    object (§23).
 *  - On failure the row is marked 'failed' (still != 'completed', so retryable)
 *    and the error is rethrown so the consumer leaves the message for redelivery
 *    and eventual DLQ.
 */
@Injectable()
export class ExportProcessor {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @Inject(EXPORT_STORAGE) private readonly storage: ExportStorage,
    private readonly metrics: MetricsService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async process(message: ExportMessage): Promise<void> {
    const start = Date.now();
    const { exportId, userId, projectId } = message;

    const claimed: unknown[] = await this.dataSource.query(
      `UPDATE exports
         SET status = 'processing',
             started_at = COALESCE(started_at, now()),
             attempt_count = attempt_count + 1,
             updated_at = now()
       WHERE id = $1 AND status <> 'completed'
       RETURNING id`,
      [exportId],
    );

    if (claimed.length === 0) {
      this.logger.info({ exportId }, 'Export already completed or missing; skipping');
      return;
    }

    try {
      const tasks = await this.tasks.find({
        where: { ownerId: userId, projectId },
        order: { createdAt: 'ASC' },
      });
      const csv = tasksToCsv(tasks);
      const key = `exports/${userId}/${exportId}.csv`;
      const stored = await this.storage.upload(key, csv);

      await this.dataSource.query(
        `UPDATE exports
           SET status = 'completed', s3_bucket = $1, s3_key = $2,
               completed_at = now(), updated_at = now()
         WHERE id = $3`,
        [stored.bucket, stored.key, exportId],
      );

      this.metrics.exportCompleted(Date.now() - start);
      this.logger.info({ exportId, taskCount: tasks.length }, 'Export completed');
    } catch (err) {
      await this.dataSource
        .query(
          `UPDATE exports
             SET status = 'failed', error_code = $1, error_message = $2, updated_at = now()
           WHERE id = $3 AND status <> 'completed'`,
          ['processing_error', (err as Error).message.slice(0, 500), exportId],
        )
        .catch(() => undefined);
      this.metrics.exportFailed();
      this.logger.error({ exportId, err: (err as Error).message }, 'Export failed; will retry');
      throw err;
    }
  }
}
