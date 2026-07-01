import { describe, it, expect, vi } from 'vitest';
import { pollOnce, clampPollSeconds } from './listener-email';

describe('clampPollSeconds', () => {
  it('floors to the min and defaults', () => {
    expect(clampPollSeconds(undefined, 30)).toBe(60);
    expect(clampPollSeconds(5, 30)).toBe(30);
    expect(clampPollSeconds(120, 30)).toBe(120);
  });
});

describe('email pollOnce', () => {
  function fakeImap(uids: number[], sources: Record<number, Buffer>) {
    const seen: number[] = [];
    return {
      seen,
      getMailboxLock: vi.fn(async () => ({ release: () => {} })),
      search: vi.fn(async () => uids),
      download: vi.fn(async (uid: string) => ({ content: bufToStream(sources[Number(uid)]) })),
      messageFlagsAdd: vi.fn(async (uid: string) => { seen.push(Number(uid)); }),
    };
  }
  function bufToStream(buf: Buffer) { const { Readable } = require('node:stream'); return Readable.from([buf]); }

  const parser = vi.fn(async () => ({
    from: { text: 'a@b.c' }, to: { text: 'x@y.z' }, subject: 'hi', date: new Date(0),
    text: 'body', html: '<p>body</p>', headerLines: [],
    attachments: [{ filename: 'f.txt', contentType: 'text/plain', content: Buffer.from('att'), size: 3 }],
  }));

  it('fetches unseen, fires with materialized attachments, marks seen AFTER onFire', async () => {
    const client = fakeImap([1], { 1: Buffer.from('raw') });
    const order: string[] = [];
    const onFire = vi.fn(async () => { order.push('fired'); });
    const writeBinary = vi.fn(async () => { order.push('wrote'); return { objectKey: 'k', contentType: 'text/plain', fileName: 'f.txt', byteSize: 3 }; });
    await pollOnce({
      client: client as never, parser: parser as never, folder: 'INBOX', markSeen: true, maxPerPoll: 50, maxBytes: 1_000,
      onFire, writeBinary, logger: { error: vi.fn(), warn: vi.fn() },
    });
    expect(onFire).toHaveBeenCalledTimes(1);
    const call0 = onFire.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    const [input, files] = call0;
    expect(input).toMatchObject({ subject: 'hi', from: 'a@b.c', text: 'body' });
    expect(files['attachment_0']).toMatchObject({ objectKey: 'k' });
    expect(client.seen).toEqual([1]);
    expect(order).toEqual(['wrote', 'fired']);
  });

  it('skips oversize attachments', async () => {
    const client = fakeImap([1], { 1: Buffer.from('raw') });
    const onFire = vi.fn(async () => {});
    const writeBinary = vi.fn(async () => ({ objectKey: 'k', contentType: 'text/plain', byteSize: 3 }));
    await pollOnce({
      client: client as never, parser: parser as never, folder: 'INBOX', markSeen: true, maxPerPoll: 50, maxBytes: 1,
      onFire, writeBinary, logger: { error: vi.fn(), warn: vi.fn() },
    });
    expect(writeBinary).not.toHaveBeenCalled();
    const [, files] = onFire.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(files).toEqual({});
  });

  it('does not mark seen when markSeen is false', async () => {
    const client = fakeImap([1], { 1: Buffer.from('raw') });
    await pollOnce({
      client: client as never, parser: parser as never, folder: 'INBOX', markSeen: false, maxPerPoll: 50, maxBytes: 1000,
      onFire: vi.fn(async () => {}), writeBinary: vi.fn(async () => ({ objectKey: 'k', contentType: 't', byteSize: 3 })), logger: { error: vi.fn(), warn: vi.fn() },
    });
    expect(client.seen).toEqual([]);
  });
});
