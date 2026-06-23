import { describe, it, expect } from 'vitest';
import { runInSandbox } from './sandbox';
import type { LogLevel } from '../types';

const LIMITS = { timeoutMs: 2000, memoryMb: 64 };
const run = (code: string, input: unknown = undefined, nodeOutputs: Record<string, unknown> = {}, onLog: (l: LogLevel, m: string) => void = () => {}) =>
  runInSandbox(code, { input, nodeOutputs, limits: LIMITS, onLog });

describe('runInSandbox', () => {
  it('returns a computed value from $input', async () => {
    expect(await run('return { doubled: $input * 2 };', 21)).toEqual({ doubled: 42 });
  });

  it('captures console.log via onLog', async () => {
    const logs: string[] = [];
    await run("console.log('hi', $input);", { a: 1 }, {}, (_l, m) => logs.push(m));
    expect(logs).toContain('hi {"a":1}');
  });

  it('exposes $node() over the snapshot', async () => {
    expect(await run("return $node('n1').v;", undefined, { n1: { v: 7 } })).toBe(7);
  });

  it('does not expose require/process/fetch', async () => {
    expect(await run('return typeof require + "," + typeof process + "," + typeof fetch;')).toBe('undefined,undefined,undefined');
  });

  it('rejects on a thrown error', async () => {
    await expect(run('throw new Error("boom");')).rejects.toThrow(/boom/);
  });

  it('kills an infinite loop at the timeout', async () => {
    await expect(runInSandbox('while (true) {}', { input: undefined, nodeOutputs: {}, limits: { timeoutMs: 300, memoryMb: 64 }, onLog: () => {} }))
      .rejects.toThrow(/timed out/);
  });

  it('rejects a non-serializable return with a clear message', async () => {
    await expect(run('return () => 1;')).rejects.toThrow(/non-serializable/);
  });

  it('returns executed marker for empty-ish code that returns nothing', async () => {
    expect(await run('const x = 1;')).toBeUndefined();
  });
});
