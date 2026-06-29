import { describe, it, expect } from 'vitest';
import { triggerHandler } from './trigger';
import { createContext } from '../execution-context';
import type { RunnerNode } from './types';

const node = (data: Record<string, unknown> = {}): RunnerNode => ({ id: 'trigger-1', type: 'trigger', data });

describe('triggerHandler', () => {
  it('normalizes ctx.input to items when set', async () => {
    const ctx = createContext([{ a: 1 }, { a: 2 }], () => {});
    const out = await triggerHandler(node(), ctx, []);
    expect(out).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });

  it('normalizes a plain object ctx.input via toItems', async () => {
    const ctx = createContext({ foo: 'bar' }, () => {});
    const out = await triggerHandler(node(), ctx, []);
    expect(out).toEqual([{ json: { foo: 'bar' } }]);
  });

  it('returns a synthetic trigger item when ctx.input is undefined', async () => {
    const ctx = createContext(undefined, () => {});
    const out = await triggerHandler(node({ triggerType: 'cron' }), ctx, []);
    expect(out).toHaveLength(1);
    expect(out[0].json).toMatchObject({ triggered: true, triggerType: 'cron' });
    expect(typeof out[0].json.timestamp).toBe('string');
  });

  it('defaults triggerType to "manual" when not specified', async () => {
    const ctx = createContext(undefined, () => {});
    const out = await triggerHandler(node(), ctx, []);
    expect(out[0].json.triggerType).toBe('manual');
  });

  it('seeds the binary lane when ctx.files is non-empty', async () => {
    const files = { file: { objectKey: 'uploads/k', contentType: 'application/octet-stream', byteSize: 3 } };
    const ctx = createContext({ hello: 'world' }, () => {}, [], undefined, undefined, undefined, undefined, files);
    const out = await triggerHandler(node(), ctx, []);
    expect(out).toHaveLength(1);
    expect(out[0].json).toEqual({ hello: 'world' });
    expect(out[0].binary).toEqual(files);
  });

  it('seeds binary lane with empty json when ctx.input is not a plain object', async () => {
    const files = { file: { objectKey: 'uploads/k', contentType: 'application/octet-stream', byteSize: 3 } };
    const ctx = createContext([{ a: 1 }], () => {}, [], undefined, undefined, undefined, undefined, files);
    const out = await triggerHandler(node(), ctx, []);
    expect(out).toHaveLength(1);
    expect(out[0].json).toEqual({});
    expect(out[0].binary).toEqual(files);
  });
});
