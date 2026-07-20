import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';
import { ExportStorage, StoredObject } from '../ports';

/** S3-backed export storage. */
@Injectable()
export class S3ExportStorage implements ExportStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const endpoint = config.get('AWS_ENDPOINT_URL');
    this.client = new S3Client({
      region: config.get('AWS_REGION') ?? 'us-east-1',
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
    this.bucket = config.get('EXPORT_BUCKET_NAME') ?? '';
  }

  async upload(key: string, body: string): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'text/csv; charset=utf-8',
      }),
    );
    return { bucket: this.bucket, key };
  }
}
