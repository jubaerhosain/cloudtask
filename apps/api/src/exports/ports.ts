import { ExportMessage } from '@cloudtask/contracts';

/** Publishes export jobs onto the queue (SQS in AWS). */
export const EXPORT_QUEUE = Symbol('EXPORT_QUEUE');
export interface ExportQueuePublisher {
  publish(message: ExportMessage): Promise<void>;
}

/** Generates short-lived download URLs for completed exports (S3 presign). */
export const EXPORT_DOWNLOADS = Symbol('EXPORT_DOWNLOADS');
export interface ExportDownloadUrls {
  getDownloadUrl(bucket: string, key: string): Promise<string>;
}
