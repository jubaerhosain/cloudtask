import { Module } from '@nestjs/common';

import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { S3ExportStorage } from './exports/aws/s3-export-storage';
import { SqsMessageQueue } from './exports/aws/sqs-message-queue';
import { ExportProcessor } from './exports/export-processor.service';
import { EXPORT_STORAGE, MESSAGE_QUEUE } from './exports/ports';
import { SqsConsumer } from './exports/sqs-consumer.service';
import { LoggerModule } from './logger/logger.module';
import { MetricsService } from './metrics/metrics.service';

@Module({
  imports: [ConfigModule, LoggerModule, DatabaseModule],
  providers: [
    MetricsService,
    ExportProcessor,
    SqsConsumer,
    { provide: MESSAGE_QUEUE, useClass: SqsMessageQueue },
    { provide: EXPORT_STORAGE, useClass: S3ExportStorage },
  ],
})
export class AppModule {}
