import { describe, it, expect, vi } from 'vitest';
import { codeHandler } from './code';
import { createContext } from '../execution-context';
import * as sandbox from '../sandbox';

const node = (code: string) => ({ id: 'c1', type: 'code', data: { code } });

describe('codeHandler — WORKFLOW_CODE_ENABLED gating (SEC-01)', () => {
  it('REFUSES to run and does NOT start the worker when codeLimits.enabled is false', async () => {
    const spy = vi.spyOn(sandbox, 'runInSandbox');
    // enabled:false is the fail-safe default for real deployments.
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: false });
    await expect(codeHandler(node('return 1;'), ctx, undefined)).rejects.toThrow(/Code nodes are disabled/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('RUNS normally when codeLimits.enabled is true', async () => {
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: true });
    expect(await codeHandler(node('return { doubled: 21 * 2 };'), ctx, undefined)).toEqual({ doubled: 42 });
  });

  it('still short-circuits empty code without touching the flag', async () => {
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: false });
    expect(await codeHandler(node('   '), ctx, undefined)).toEqual({ executed: true, output: undefined });
  });

  it('warns once (host-level execution) when an enabled Code node runs', async () => {
    const warn = vi.fn();
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: true });
    await codeHandler(node('return 1;'), { ...ctx, logger: { warn } } as never, undefined);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/host-level/i);
  });
});
