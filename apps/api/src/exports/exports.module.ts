import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { S3DownloadUrls } from './aws/s3-download-urls';
import { SqsExportPublisher } from './aws/sqs-export-publisher';
import { ExportJob } from './export.entity';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { EXPORT_DOWNLOADS, EXPORT_QUEUE } from './ports';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [TypeOrmModule.forFeature([ExportJob]), ProjectsModule],
  controllers: [ExportsController],
  providers: [
    ExportsService,
    { provide: EXPORT_QUEUE, useClass: SqsExportPublisher },
    { provide: EXPORT_DOWNLOADS, useClass: S3DownloadUrls },
  ],
})
export class ExportsModule {}
