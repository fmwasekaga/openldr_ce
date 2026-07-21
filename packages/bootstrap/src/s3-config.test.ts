import { describe, it, expect } from 'vitest';
import { toS3BucketConfig } from './s3-config';

describe('toS3BucketConfig', () => {
  it('maps the S3_* config fields onto S3BucketConfig', () => {
    const cfg = { S3_ENDPOINT: 'http://minio:9000', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'ak', S3_SECRET_ACCESS_KEY: 'sk', S3_BUCKET: 'openldr', S3_FORCE_PATH_STYLE: true } as never;
    expect(toS3BucketConfig(cfg)).toEqual({ endpoint: 'http://minio:9000', region: 'us-east-1', accessKeyId: 'ak', secretAccessKey: 'sk', bucket: 'openldr', forcePathStyle: true });
  });
});
