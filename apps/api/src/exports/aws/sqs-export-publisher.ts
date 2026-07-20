import { ExportMessage } from '@cloudtask/contracts';
import { Injectable } from '@nestjs/common';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import { ConfigService } from '../../config/config.service';
import { ExportQueuePublisher } from '../ports';

/** SQS-backed export publisher. The AWS SDK honors AWS_ENDPOINT_URL for
 * LocalStack; in AWS the endpoint is unset and the real service is used. */
@Injectable()
export class SqsExportPublisher implements ExportQueuePublisher {
  private readonly client: SQSClient;
  private readonly queueUrl: string;

  constructor(config: ConfigService) {
    const endpoint = config.get('AWS_ENDPOINT_URL');
    this.client = new SQSClient({
      region: config.get('AWS_REGION') ?? 'us-east-1',
      ...(endpoint ? { endpoint } : {}),
    });
    this.queueUrl = config.get('EXPORT_QUEUE_URL') ?? '';
  }

  async publish(message: ExportMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify(message) }),
    );
  }
}
