import { describe, it, expect, vi } from 'vitest';
import { createS3Bucket } from './index';

function fakeClient(send: () => Promise<unknown>) {
  return { send: vi.fn(send) };
}

const cfg = {
  endpoint: 'http://localhost:9010',
  region: 'us-east-1',
  accessKeyId: 'minio',
  secretAccessKey: 'minio12345',
  bucket: 'openldr',
  forcePathStyle: true,
};

describe('createS3Bucket', () => {
  it('reports up when the bucket is reachable', async () => {
    const client = fakeClient(async () => ({}));
    const blob = createS3Bucket(cfg, { client: client as never });
    const r = await blob.healthCheck();
    expect(r.status).toBe('up');
    expect(client.send).toHaveBeenCalledOnce();
  });

  it('reports down when HeadBucket fails', async () => {
    const client = fakeClient(async () => { throw new Error('NoSuchBucket'); });
    const blob = createS3Bucket(cfg, { client: client as never });
    const r = await blob.healthCheck();
    expect(r.status).toBe('down');
    expect(r.detail).toContain('NoSuchBucket');
  });

  describe('exists', () => {
    it('returns true when HeadObject succeeds', async () => {
      const client = fakeClient(async () => ({}));
      const blob = createS3Bucket(cfg, { client: client as never });
      expect(await blob.exists('some/key')).toBe(true);
    });

    it('returns false on a genuine 404 NotFound', async () => {
      const client = fakeClient(async () => {
        throw { name: 'NotFound', $metadata: { httpStatusCode: 404 } };
      });
      const blob = createS3Bucket(cfg, { client: client as never });
      expect(await blob.exists('missing/key')).toBe(false);
    });

    it('rethrows non-404 errors (e.g. 403 AccessDenied) instead of masking as absent', async () => {
      const client = fakeClient(async () => {
        throw { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } };
      });
      const blob = createS3Bucket(cfg, { client: client as never });
      await expect(blob.exists('forbidden/key')).rejects.toMatchObject({ name: 'AccessDenied' });
    });
  });
});
