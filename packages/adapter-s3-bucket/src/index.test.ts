import { describe, it, expect, vi } from 'vitest';
import { createS3Bucket } from './index';

function fakeClient(send: () => Promise<unknown>) {
  return { send: vi.fn(send) };
}

const cfg = {
  endpoint: 'http://localhost:9000',
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
});
