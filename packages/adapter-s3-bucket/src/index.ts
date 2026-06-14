import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { probe } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';

export interface S3BucketConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
}

export interface S3BucketDeps {
  client?: S3Client;
}

export function createS3Bucket(cfg: S3BucketConfig, deps: S3BucketDeps = {}): BlobStoragePort {
  const client =
    deps.client ??
    new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });

  return {
    async healthCheck() {
      return probe(async () => {
        await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
        return `bucket ${cfg.bucket} reachable`;
      });
    },
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) throw new Error(`empty object: ${key}`);
      return bytes;
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return true;
      } catch (err) {
        const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
          return false;
        }
        throw err; // propagate credential / permission / network errors instead of masking them
      }
    },
    async presign(key, expiresInSeconds = 900) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },
  };
}
