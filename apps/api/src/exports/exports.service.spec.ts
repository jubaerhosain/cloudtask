import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { ExportJob } from './export.entity';
import { ExportsService } from './exports.service';
import { ExportDownloadUrls, ExportQueuePublisher } from './ports';
import { ProjectsService } from '../projects/projects.service';

function makeJob(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    id: 'exp-1',
    projectId: 'proj-1',
    userId: 'user-1',
    status: 'queued',
    s3Bucket: null,
    s3Key: null,
    errorCode: null,
    errorMessage: null,
    attemptCount: 0,
    requestedAt: new Date('2026-01-01T00:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ExportsService', () => {
  let repo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let projects: { getOne: jest.Mock };
  let queue: jest.Mocked<ExportQueuePublisher>;
  let downloads: jest.Mocked<ExportDownloadUrls>;
  let service: ExportsService;

  beforeEach(() => {
    repo = {
      create: jest.fn((x: unknown) => x as ExportJob),
      save: jest.fn(async (x) => x as ExportJob),
      findOne: jest.fn(),
    };
    projects = { getOne: jest.fn().mockResolvedValue({ id: 'proj-1' }) };
    queue = { publish: jest.fn().mockResolvedValue(undefined) };
    downloads = { getDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/file.csv') };
    service = new ExportsService(
      repo as unknown as Repository<ExportJob>,
      projects as unknown as ProjectsService,
      queue,
      downloads,
    );
  });

  describe('requestExport', () => {
    it('creates a queued record and publishes the correct message envelope', async () => {
      repo.save.mockResolvedValue(makeJob());

      const result = await service.requestExport('user-1', 'proj-1');

      expect(projects.getOne).toHaveBeenCalledWith('user-1', 'proj-1');
      expect(result).toEqual({ exportId: 'exp-1', status: 'queued' });
      expect(queue.publish).toHaveBeenCalledWith({
        schemaVersion: 1,
        exportId: 'exp-1',
        projectId: 'proj-1',
        userId: 'user-1',
        requestedAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('marks the record failed and throws 503 when publishing fails (no false success)', async () => {
      repo.save.mockResolvedValueOnce(makeJob()); // initial queued insert
      queue.publish.mockRejectedValue(new Error('SQS down'));
      const saved: ExportJob[] = [];
      repo.save.mockImplementation(async (j) => {
        saved.push({ ...(j as ExportJob) });
        return j as ExportJob;
      });

      await expect(service.requestExport('user-1', 'proj-1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(saved.at(-1)).toMatchObject({ status: 'failed', errorCode: 'queue_unavailable' });
    });

    it('propagates 404 without publishing when the project is not owned', async () => {
      projects.getOne.mockRejectedValue(new NotFoundException());
      await expect(service.requestExport('user-1', 'proj-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(queue.publish).not.toHaveBeenCalled();
    });
  });

  describe('getExport', () => {
    it('404s when the export is not found for the caller', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getExport('user-1', 'exp-x')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'exp-x', userId: 'user-1' } });
    });

    it('returns a presigned download URL for a completed export', async () => {
      repo.findOne.mockResolvedValue(
        makeJob({
          status: 'completed',
          s3Bucket: 'bucket',
          s3Key: 'exports/user-1/exp-1.csv',
          completedAt: new Date('2026-01-02T00:00:00.000Z'),
        }),
      );

      const result = await service.getExport('user-1', 'exp-1');

      expect(downloads.getDownloadUrl).toHaveBeenCalledWith('bucket', 'exports/user-1/exp-1.csv');
      expect(result.downloadUrl).toBe('https://signed.example/file.csv');
      expect(result.status).toBe('completed');
      expect(result.completedAt).toBe('2026-01-02T00:00:00.000Z');
    });

    it('does not generate a URL for a non-completed export', async () => {
      repo.findOne.mockResolvedValue(makeJob({ status: 'processing' }));
      const result = await service.getExport('user-1', 'exp-1');
      expect(downloads.getDownloadUrl).not.toHaveBeenCalled();
      expect(result.downloadUrl).toBeNull();
    });
  });
});
