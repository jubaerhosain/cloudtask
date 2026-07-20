import { z } from 'zod';

export const exportStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed']);
export type ExportStatus = z.infer<typeof exportStatusSchema>;

/** POST /projects/:id/exports response (HTTP 202, spec §6.5). */
export const createExportResponseSchema = z.object({
  exportId: z.string().uuid(),
  status: z.literal('queued'),
});
export type CreateExportResponse = z.infer<typeof createExportResponseSchema>;

/** GET /exports/:id response. `downloadUrl` is a 5-minute presigned URL, set
 * only when the export is completed. */
export const exportResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: exportStatusSchema,
  requestedAt: z.string(),
  completedAt: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  errorCode: z.string().nullable(),
});
export type ExportResponse = z.infer<typeof exportResponseSchema>;

/** SQS message envelope for an export job (spec §6.5). */
export const exportMessageSchema = z.object({
  schemaVersion: z.literal(1),
  exportId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  requestedAt: z.string(),
});
export type ExportMessage = z.infer<typeof exportMessageSchema>;
