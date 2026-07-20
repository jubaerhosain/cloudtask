import { ExportMessage } from '@cloudtask/contracts';
import { DataSource, Repository } from 'typeorm';

import { ExportProcessor } from './export-processor.service';
import { ExportStorage } from './ports';
import { Task } from '../database/entities/task.entity';
import { Logger } from '../logger/logger';
import { MetricsService } from '../metrics/metrics.service';

const message: ExportMessage = {
  schemaVersion: 1,
  exportId: 'exp-1',
  projectId: 'proj-1',
  userId: 'user-1',
  requestedAt: '2026-01-01T00:00:00.000Z',
};

function makeTask(): Task {
  return {
    id: 't1',
    projectId: 'proj-1',
    ownerId: 'user-1',
    title: 'Task',
    description: null,
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('ExportProcessor', () => {
  let ds: { query: jest.Mock };
  let tasks: { find: jest.Mock };
  let storage: jest.Mocked<ExportStorage>;
  let metrics: { exportCompleted: jest.Mock; exportFailed: jest.Mock };
  let logger: Logger;
  let processor: ExportProcessor;

  beforeEach(() => {
    ds = { query: jest.fn() };
    tasks = { find: jest.fn().mockResolvedValue([makeTask()]) };
    storage = { upload: jest.fn().mockResolvedValue({ bucket: 'bucket', key: 'exports/user-1/exp-1.csv' }) };
    metrics = { exportCompleted: jest.fn(), exportFailed: jest.fn() };
    logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as unknown as Logger;
    processor = new ExportProcessor(
      ds as unknown as DataSource,
      tasks as unknown as Repository<Task>,
      storage,
      metrics as unknown as MetricsService,
      logger,
    );
  });

  it('claims, uploads to the deterministic key, marks completed, and records a metric', async () => {
    ds.query
      .mockResolvedValueOnce([{ id: 'exp-1' }]) // claim
      .mockResolvedValueOnce([]); // completed update

    await processor.process(message);

    expect(storage.upload).toHaveBeenCalledWith('exports/user-1/exp-1.csv', expect.any(String));
    // second query is the "completed" update, carrying bucket + key
    expect(ds.query.mock.calls[1][0]).toContain("status = 'completed'");
    expect(ds.query.mock.calls[1][1]).toEqual(['bucket', 'exports/user-1/exp-1.csv', 'exp-1']);
    expect(metrics.exportCompleted).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a claim that matches nothing (already completed) skips work', async () => {
    ds.query.mockResolvedValueOnce([]); // claim matched nothing

    await processor.process(message);

    expect(tasks.find).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(metrics.exportCompleted).not.toHaveBeenCalled();
  });

  it('marks failed (retryable) and rethrows when upload fails', async () => {
    ds.query
      .mockResolvedValueOnce([{ id: 'exp-1' }]) // claim
      .mockResolvedValueOnce([]); // failure update
    storage.upload.mockRejectedValue(new Error('S3 down'));

    await expect(processor.process(message)).rejects.toThrow('S3 down');

    const failUpdate = ds.query.mock.calls[1];
    expect(failUpdate[0]).toContain("status = 'failed'");
    expect(failUpdate[0]).toContain("status <> 'completed'"); // stays retryable
    expect(metrics.exportFailed).toHaveBeenCalledTimes(1);
  });
});
