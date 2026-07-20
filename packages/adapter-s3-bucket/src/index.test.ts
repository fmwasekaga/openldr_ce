import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
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

function fakeClientWithHandlers(handlers: Record<string, (input: any) => any>) {
  const calls: { name: string; input: any }[] = [];
  return {
    calls,
    // @aws-sdk/lib-storage's `Upload` helper (used by putStream) inspects `client.config`
    // directly (requestHandler, endpoint(), forcePathStyle) even for a single-PUT small body,
    // so the fake needs a minimal config alongside `send`.
    config: {
      requestHandler: undefined,
      forcePathStyle: cfg.forcePathStyle,
      endpoint: async () => {
        const u = new URL(cfg.endpoint);
        return { protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.pathname || '/' };
      },
    },
    send: async (cmd: any) => {
      const name = cmd.constructor.name;
      calls.push({ name, input: cmd.input });
      const h = handlers[name];
      if (!h) throw new Error(`unexpected command ${name}`);
      return h(cmd.input);
    },
  };
}

describe('s3 bucket streaming', () => {
  it('putStream uploads a small body via a single PutObject', async () => {
    const client = fakeClientWithHandlers({ PutObjectCommand: () => ({}) });
    const blob = createS3Bucket(cfg, { client: client as never });
    await blob.putStream('k1.zip', Readable.from([Buffer.from('hello')]), 'application/zip');
    const put = client.calls.find((c) => c.name === 'PutObjectCommand');
    expect(put?.input).toMatchObject({ Bucket: 'openldr', Key: 'k1.zip', ContentType: 'application/zip' });
  });

  it('getStream returns the object body as a Readable', async () => {
    const body = Readable.from([Buffer.from('zipbytes')]);
    const client = fakeClientWithHandlers({ GetObjectCommand: () => ({ Body: body }) });
    const blob = createS3Bucket(cfg, { client: client as never });
    const out = await blob.getStream('k1.zip');
    const chunks: Buffer[] = [];
    for await (const c of out) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).toString()).toBe('zipbytes');
  });

  it('delete sends DeleteObjectCommand', async () => {
    const client = fakeClientWithHandlers({ DeleteObjectCommand: () => ({}) });
    const blob = createS3Bucket(cfg, { client: client as never });
    await blob.delete('k1.zip');
    expect(client.calls.at(-1)).toMatchObject({ name: 'DeleteObjectCommand', input: { Bucket: 'openldr', Key: 'k1.zip' } });
  });
});
