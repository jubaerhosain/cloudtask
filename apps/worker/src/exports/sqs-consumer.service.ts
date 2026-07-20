import { exportMessageSchema } from '@cloudtask/contracts';
import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { ExportProcessor } from './export-processor.service';
import { MESSAGE_QUEUE, MessageQueue, QueueMessage } from './ports';
import { Logger, LOGGER } from '../logger/logger';

/**
 * Long-polls the queue and dispatches messages to the processor. A message is
 * deleted only after the processor succeeds; on any failure it is left for
 * SQS redelivery and eventual DLQ (redrive maxReceiveCount=3). Graceful
 * shutdown stops the loop and waits for the current iteration to finish.
 */
@Injectable()
export class SqsConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private running = false;
  private loop: Promise<void> = Promise.resolve();

  constructor(
    @Inject(MESSAGE_QUEUE) private readonly queue: MessageQueue,
    private readonly processor: ExportProcessor,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    this.running = true;
    this.loop = this.run();
    this.logger.info('SQS consumer started');
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await this.loop;
    this.logger.info('SQS consumer stopped');
  }

  private async run(): Promise<void> {
    while (this.running) {
      let messages: QueueMessage[] = [];
      try {
        messages = await this.queue.receive();
      } catch (err) {
        this.logger.error({ err: (err as Error).message }, 'Failed to receive messages');
        await delay(1000);
        continue;
      }
      for (const message of messages) {
        if (!this.running) break;
        await this.handle(message);
      }
    }
  }

  private async handle(message: QueueMessage): Promise<void> {
    try {
      const parsed = exportMessageSchema.parse(JSON.parse(message.body));
      await this.processor.process(parsed);
      await this.queue.delete(message.receiptHandle);
    } catch (err) {
      this.logger.error(
        { messageId: message.messageId, err: (err as Error).message },
        'Message processing failed; leaving for retry/DLQ',
      );
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
