import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';
import { MessageQueue, QueueMessage } from '../ports';

/** SQS-backed queue using long polling (spec §6.5). */
@Injectable()
export class SqsMessageQueue implements MessageQueue {
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private readonly waitTimeSeconds: number;
  private readonly visibilityTimeout: number;

  constructor(config: ConfigService) {
    const endpoint = config.get('AWS_ENDPOINT_URL');
    this.client = new SQSClient({
      region: config.get('AWS_REGION') ?? 'us-east-1',
      ...(endpoint ? { endpoint } : {}),
    });
    this.queueUrl = config.get('EXPORT_QUEUE_URL') ?? '';
    this.waitTimeSeconds = config.get('SQS_WAIT_TIME_SECONDS');
    this.visibilityTimeout = config.get('SQS_VISIBILITY_TIMEOUT_SECONDS');
  }

  async receive(): Promise<QueueMessage[]> {
    const out = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: this.waitTimeSeconds,
        VisibilityTimeout: this.visibilityTimeout,
      }),
    );
    return (out.Messages ?? []).map((m) => ({
      messageId: m.MessageId ?? '',
      receiptHandle: m.ReceiptHandle ?? '',
      body: m.Body ?? '',
    }));
  }

  async delete(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle }),
    );
  }
}
