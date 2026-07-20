/** A message pulled from the queue. */
export interface QueueMessage {
  messageId: string;
  receiptHandle: string;
  body: string;
}

export const MESSAGE_QUEUE = Symbol('MESSAGE_QUEUE');
export interface MessageQueue {
  /** Long-poll for a batch of messages (may be empty). */
  receive(): Promise<QueueMessage[]>;
  delete(receiptHandle: string): Promise<void>;
}

export interface StoredObject {
  bucket: string;
  key: string;
}

export const EXPORT_STORAGE = Symbol('EXPORT_STORAGE');
export interface ExportStorage {
  upload(key: string, body: string): Promise<StoredObject>;
}
