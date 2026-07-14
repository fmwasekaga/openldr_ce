import { describe, it, expect, vi } from 'vitest';
import { codeHandler } from './code';
import { createContext } from '../execution-context';
import * as isolate from '../js-isolate';
import type { WorkflowItem } from '../items';

const node = (code: string) => ({ id: 'c1', type: 'code', data: { code } });

describe('codeHandler — WORKFLOW_CODE_ENABLED gating (SEC-01)', () => {
  it('REFUSES to run and does NOT start the isolate when codeLimits.enabled is false', async () => {
    const spy = vi.spyOn(isolate, 'runScript');
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

  it('wraps a bare object return via toItems (applied once, inside runScript)', async () => {
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: true });
    const result = await codeHandler(node('return { a: 1 };'), ctx, []);
    expect(result).toEqual([{ json: { a: 1 } }]);
  });

  it('empty code returns input unchanged (isolate never started)', async () => {
    const spy = vi.spyOn(isolate, 'runScript');
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: false });
    const input: WorkflowItem[] = [{ json: { x: 42 } }];
    const result = await codeHandler(node('   '), ctx, input);
    expect(result).toEqual(input);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('wraps a thrown error with the "Code node error:" prefix', async () => {
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: true });
    await expect(codeHandler(node('throw new Error("boom");'), ctx, [])).rejects.toThrow(
      /Code node error: .*boom/,
    );
  });

  it('exposes $json from the first input item in the isolate', async () => {
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: true });
    const input: WorkflowItem[] = [{ json: { n: 5 } }];
    // $json is the first item's json — so $json.n should be 5
    const result = await codeHandler(node('return { val: $json.n };'), ctx, input);
    expect(result).toEqual([{ json: { val: 5 } }]);
  });

  it('streams console.log through the run log via onLog', async () => {
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: true });
    const input: WorkflowItem[] = [{ json: { a: 1 } }];
    await codeHandler(node("console.log('hi', $json); return [];"), ctx, input);
    const lines = (ctx.logs['c1'] ?? []).map((e) => e.message);
    expect(lines).toContain('hi {"a":1}');
  });
});

// SECURITY BOUNDARY (SEC-01) — INVERTED from the old vm/worker "escape documentation".
// The old sandbox proved `this.constructor.constructor('return process')()` REACHED the
// host process. The Code node now runs in a QuickJS-WASM isolate, so these tests assert
// the boundary HOLDS: no `process`, no `require`, no host globals are reachable.
describe('codeHandler — QuickJS isolate boundary holds (no host access)', () => {
  const runCode = async (code: string): Promise<WorkflowItem[]> => {
    const ctx = createContext(undefined, () => {}, [], { timeoutMs: 2000, memoryMb: 64, enabled: true });
    return codeHandler(node(code), ctx, []);
  };

  it('process/require/fetch are all undefined inside the isolate', async () => {
    const result = await runCode(
      'return { v: typeof process + "," + typeof require + "," + typeof fetch };',
    );
    expect(result).toEqual([{ json: { v: 'undefined,undefined,undefined' } }]);
  });

  it('the constructor-chain escape can NOT reach a host process object', async () => {
    // In the isolate there is no host `process`; the constructor chain yields
    // 'undefined', proving the escape route is closed (the old vm returned 'object').
    const result = await runCode(
      "return { escaped: this.constructor.constructor('return typeof process')() };",
    );
    expect(result).toEqual([{ json: { escaped: 'undefined' } }]);
  });

  it('globalThis exposes no host filesystem/module hooks', async () => {
    const result = await runCode(
      'return { v: typeof globalThis.process + "," + typeof globalThis.require + "," + typeof globalThis.global };',
    );
    expect(result).toEqual([{ json: { v: 'undefined,undefined,undefined' } }]);
  });
});
