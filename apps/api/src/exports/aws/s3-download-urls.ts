import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';
import { ExportDownloadUrls } from '../ports';

/** Presigned S3 download URLs, valid for 5 minutes (spec §6.5). */
@Injectable()
export class S3DownloadUrls implements ExportDownloadUrls {
  private static readonly EXPIRES_IN_SECONDS = 300;
  private readonly client: S3Client;

  constructor(config: ConfigService) {
    const endpoint = config.get('AWS_ENDPOINT_URL');
    this.client = new S3Client({
      region: config.get('AWS_REGION') ?? 'us-east-1',
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  getDownloadUrl(bucket: string, key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: S3DownloadUrls.EXPIRES_IN_SECONDS,
    });
  }
}
