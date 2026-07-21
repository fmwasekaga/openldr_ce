import type { Config } from '@openldr/config';
import { createS3Bucket, type S3BucketConfig } from '@openldr/adapter-s3-bucket';
import type { BlobStoragePort } from '@openldr/ports';

export function toS3BucketConfig(cfg: Config): S3BucketConfig {
  return {
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    accessKeyId: cfg.S3_ACCESS_KEY_ID,
    secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
    bucket: cfg.S3_BUCKET,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
  };
}

export function createBlobFromConfig(cfg: Config): BlobStoragePort {
  return createS3Bucket(toS3BucketConfig(cfg));
}
