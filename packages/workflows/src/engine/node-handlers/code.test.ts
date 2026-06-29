import { describe, it, expect, vi } from 'vitest';
import { codeHandler } from './code';
import { createContext } from '../execution-context';
import * as sandbox from '../sandbox';
import type { WorkflowItem } from '../items';

const node = (code: string) => ({ id: 'c1', type: 'code', data: { code } });

describe('codeHandler — WORKFLOW_CODE_ENABLED gating (SEC-01)', () => {
  it('REFUSES to run and does NOT start the worker when codeLimits.enabled is false', async () => {
    const spy = vi.spyOn(sandbox, 'runInSandbox');
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: false });
    await expect(codeHandler(node('return 1;'), ctx, [])).rejects.toThrow(/Code nodes are disabled/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('RUNS normally when codeLimits.enabled is true — returns items', async () => {
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: true });
    const input: WorkflowItem[] = [{ json: { n: 2 } }];
    const result = await codeHandler(node('return [{ json: { doubled: $json.n * 2 } }];'), ctx, input);
    expect(result).toEqual([{ json: { doubled: 4 } }]);
  });

  it('wraps a bare object return via toItems', async () => {
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: true });
    const result = await codeHandler(node('return { a: 1 };'), ctx, []);
    expect(result).toEqual([{ json: { a: 1 } }]);
  });

  it('empty code returns input unchanged (no worker started)', async () => {
    const spy = vi.spyOn(sandbox, 'runInSandbox');
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: false });
    const input: WorkflowItem[] = [{ json: { x: 42 } }];
    const result = await codeHandler(node('   '), ctx, input);
    expect(result).toEqual(input);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('warns once (host-level execution) when an enabled Code node runs', async () => {
    const warn = vi.fn();
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: true });
    await codeHandler(node('return 1;'), { ...ctx, logger: { warn } } as never, []);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/host-level/i);
  });

  it('exposes $json from the first input item in the sandbox', async () => {
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: true });
    const input: WorkflowItem[] = [{ json: { n: 5 } }];
    // $json is the first item's json — so $json.n should be 5
    const result = await codeHandler(node('return { val: $json.n };'), ctx, input);
    expect(result).toEqual([{ json: { val: 5 } }]);
  });
});
