import { describe, it, expect } from 'vitest';
import { evalExpression, runScript, type JsLimits } from './js-isolate';
import type { WorkflowItem } from './items';
import type { LogLevel } from '../types';

const L: JsLimits = { timeoutMs: 1000, memoryMb: 16 };

// Generous-ish Code-node budget for the runScript suite (kept modest so limit tests are quick).
const CL: JsLimits = { timeoutMs: 2000, memoryMb: 64 };

/** Run a Code-node script with a captured onLog. */
function run(
  source: string,
  input: WorkflowItem[] = [],
  nodeOutputs: Record<string, WorkflowItem[]> = {},
  limits: JsLimits = CL,
): { result: Promise<WorkflowItem[]>; logs: [LogLevel, string][] } {
  const logs: [LogLevel, string][] = [];
  const result = runScript(source, {
    input,
    nodeOutputs,
    limits,
    onLog: (level, message) => logs.push([level, message]),
  });
  return { result, logs };
}

describe('evalExpression — host escape is blocked (the whole point)', () => {
  it('constructor.constructor("return process") does not yield a usable host process', async () => {
    // Either it throws (process is a ReferenceError inside the isolate) or the
    // returned value is not a usable host process object.
    let result: unknown;
    let threw = false;
    try {
      result = await evalExpression(
        "this.constructor.constructor('return process')()",
        {},
        L,
      );
    } catch {
      threw = true;
    }
    if (!threw) {
      expect(result == null || (result as { env?: unknown }).env === undefined).toBe(true);
    } else {
      expect(threw).toBe(true);
    }
  });

  it('typeof process === "undefined"', async () => {
    expect(await evalExpression('typeof process', {}, L)).toBe('undefined');
  });

  it('typeof require === "undefined"', async () => {
    expect(await evalExpression('typeof require', {}, L)).toBe('undefined');
  });

  it('typeof globalThis.process === "undefined"', async () => {
    expect(await evalExpression('typeof globalThis.process', {}, L)).toBe('undefined');
  });

  it('typeof globalThis.require === "undefined"', async () => {
    expect(await evalExpression('typeof globalThis.require', {}, L)).toBe('undefined');
  });
});

describe('evalExpression — real workflow conditions', () => {
  it('strict equality on injected $json', async () => {
    expect(await evalExpression('$json.status === 200', { $json: { status: 200 } }, L)).toBe(true);
    expect(await evalExpression('$json.status === 200', { $json: { status: 500 } }, L)).toBe(false);
  });

  it('numeric comparison >=', async () => {
    expect(await evalExpression('$json.status >= 400', { $json: { status: 500 } }, L)).toBe(true);
    expect(await evalExpression('$json.status >= 400', { $json: { status: 200 } }, L)).toBe(false);
  });

  it('nested property access $json.a.b', async () => {
    expect(await evalExpression('$json.a.b', { $json: { a: { b: 42 } } }, L)).toBe(42);
  });

  it('logical AND', async () => {
    expect(await evalExpression('$json.a && $json.b', { $json: { a: true, b: true } }, L)).toBe(true);
    expect(await evalExpression('$json.a && $json.b', { $json: { a: true, b: false } }, L)).toBe(false);
  });

  it('ternary', async () => {
    expect(
      await evalExpression("$json.n > 0 ? 'pos' : 'neg'", { $json: { n: 5 } }, L),
    ).toBe('pos');
    expect(
      await evalExpression("$json.n > 0 ? 'pos' : 'neg'", { $json: { n: -5 } }, L),
    ).toBe('neg');
  });

  it('String.includes', async () => {
    expect(await evalExpression("$json.s.includes('x')", { $json: { s: 'axb' } }, L)).toBe(true);
    expect(await evalExpression("$json.s.includes('x')", { $json: { s: 'abc' } }, L)).toBe(false);
  });

  it('array length via $items', async () => {
    expect(await evalExpression('$items.length > 0', { $items: [1, 2, 3] }, L)).toBe(true);
    expect(await evalExpression('$items.length > 0', { $items: [] }, L)).toBe(false);
  });
});

describe('evalExpression — resource limits', () => {
  it('rejects an infinite loop on the wall-time limit (does not hang)', async () => {
    const started = Date.now();
    await expect(
      evalExpression('while(true){}', {}, { timeoutMs: 200, memoryMb: 32 }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  }, 5000);

  it('rejects a large allocation on the memory limit', async () => {
    await expect(
      // Attempt to allocate a ~256MB string under a 16MB ceiling.
      evalExpression("'x'.repeat(256 * 1024 * 1024)", {}, { timeoutMs: 2000, memoryMb: 16 }),
    ).rejects.toThrow();
  }, 5000);
});

describe('evalExpression — JSON marshaling round-trip', () => {
  it('injects and reads back primitives', async () => {
    expect(await evalExpression('$n', { $n: 42 }, L)).toBe(42);
    expect(await evalExpression('$s', { $s: 'hello' }, L)).toBe('hello');
    expect(await evalExpression('$b', { $b: true }, L)).toBe(true);
    expect(await evalExpression('$z', { $z: null }, L)).toBe(null);
  });

  it('injects and reads back nested objects and arrays', async () => {
    const obj = { a: 1, b: { c: [2, 3], d: 'x' }, e: [{ f: true }] };
    expect(await evalExpression('$o', { $o: obj }, L)).toEqual(obj);
  });

  it('computes and reads back an object result', async () => {
    expect(
      await evalExpression('({ sum: $a + $b, list: [$a, $b] })', { $a: 2, $b: 3 }, L),
    ).toEqual({ sum: 5, list: [2, 3] });
  });

  it('normalizes injected undefined to null but keeps the var defined', async () => {
    expect(await evalExpression('typeof $u', { $u: undefined }, L)).toBe('object'); // typeof null === 'object'
    expect(await evalExpression('$u', { $u: undefined }, L)).toBe(null);
  });

  it('normalizes a non-serializable function scope value to null (no throw)', async () => {
    // JSON.stringify drops functions/symbols; we coerce to null so the var is defined.
    expect(await evalExpression('$fn', { $fn: () => 1 }, L)).toBe(null);
    expect(await evalExpression('typeof $fn', { $fn: () => 1 }, L)).toBe('object');
  });

  it('reads back an undefined result via ctx.dump (distinct from injected-undefined)', async () => {
    expect(await evalExpression('void 0', {}, L)).toBeUndefined();
    expect(await evalExpression('undefined', {}, L)).toBeUndefined();
  });
});

describe('evalExpression — scope serialization errors', () => {
  it('rejects a bigint scope value with a message naming the key', async () => {
    await expect(evalExpression('$big', { $big: 10n }, L)).rejects.toThrow(/\$big/);
  });

  it('rejects a circular scope value with a message naming the key', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(evalExpression('$c', { $c: circular }, L)).rejects.toThrow(/\$c/);
  });
});

describe('evalExpression — malformed source', () => {
  it('throws a clear Error on a syntax error', async () => {
    await expect(evalExpression('this is not js (', {}, L)).rejects.toThrow();
  });

  it('throws on a reference to an undefined identifier', async () => {
    await expect(evalExpression('someUndefinedThing.foo', {}, L)).rejects.toThrow();
  });
});

describe('runScript — host escape is blocked (the whole point)', () => {
  it('process/require are undefined inside a Code node', async () => {
    const { result } = run('return [{ json: { p: typeof process, r: typeof require } }]');
    expect(await result).toEqual([{ json: { p: 'undefined', r: 'undefined' } }]);
  });

  it('constructor.constructor("return process")() yields no usable host process', async () => {
    let items: WorkflowItem[] | undefined;
    let threw = false;
    try {
      const { result } = run(
        "const p = this.constructor.constructor('return process')(); return [{ json: { hasEnv: !!(p && p.env) } }]",
      );
      items = await result;
    } catch {
      threw = true;
    }
    if (!threw) {
      // If it evaluated, there must be no reachable host process.env.
      expect(items).toEqual([{ json: { hasEnv: false } }]);
    } else {
      expect(threw).toBe(true);
    }
  });

  it('no fs/net globals are reachable', async () => {
    const { result } = run(
      "return [{ json: { globalThisProcess: typeof globalThis.process } }]",
    );
    expect(await result).toEqual([{ json: { globalThisProcess: 'undefined' } }]);
  });
});

describe('runScript — behavior', () => {
  it('maps over input items', async () => {
    const { result } = run('return input.map(i => ({ json: { doubled: i.json.n * 2 } }))', [
      { json: { n: 2 } },
    ]);
    expect(await result).toEqual([{ json: { doubled: 4 } }]);
  });

  it('$json resolves to the first item json', async () => {
    const { result } = run('return [{ json: { got: $json.n } }]', [{ json: { n: 7 } }]);
    expect(await result).toEqual([{ json: { got: 7 } }]);
  });

  it('$items resolves to the json of every input item', async () => {
    const { result } = run('return [{ json: { items: $items } }]', [
      { json: { a: 1 } },
      { json: { a: 2 } },
    ]);
    expect(await result).toEqual([{ json: { items: [{ a: 1 }, { a: 2 }] } }]);
  });

  it("$node('x') resolves the named node's output", async () => {
    const { result } = run("return [{ json: { fromX: $node('x') } }]", [], {
      x: [{ json: { v: 99 } }],
    });
    expect(await result).toEqual([{ json: { fromX: [{ json: { v: 99 } }] } }]);
  });

  it("$node returns undefined for an unknown node id", async () => {
    const { result } = run("return [{ json: { missing: $node('nope') === undefined } }]");
    expect(await result).toEqual([{ json: { missing: true } }]);
  });

  it("console.log('hi', {a:1}) triggers onLog('log', 'hi {\"a\":1}')", async () => {
    const { result, logs } = run("console.log('hi', {a:1}); return [];");
    await result;
    expect(logs).toEqual([['log', 'hi {"a":1}']]);
  });

  it('console.info/warn/error map to the right levels', async () => {
    const { result, logs } = run(
      "console.info('i'); console.warn('w'); console.error('e'); console.debug('d'); return [];",
    );
    await result;
    expect(logs).toEqual([
      ['info', 'i'],
      ['warn', 'w'],
      ['error', 'e'],
      ['log', 'd'],
    ]);
  });
});

describe('runScript — async (proves the promise-resolution path)', () => {
  it('awaits a resolved promise then returns', async () => {
    const { result } = run(
      'const v = await Promise.resolve(21); return [{ json: { v: v * 2 } }];',
    );
    expect(await result).toEqual([{ json: { v: 42 } }]);
  });

  it('supports multiple awaits in sequence', async () => {
    const { result } = run(
      'const a = await Promise.resolve(1); const b = await Promise.resolve(a + 1); return [{ json: { b } }];',
    );
    expect(await result).toEqual([{ json: { b: 2 } }]);
  });

  it('a rejected promise surfaces as a thrown host Error', async () => {
    const { result } = run("await Promise.reject(new Error('boom')); return [];");
    await expect(result).rejects.toThrow();
  });
});

describe('runScript — resource limits', () => {
  it('rejects an infinite loop on the wall-time limit (does not hang)', async () => {
    const started = Date.now();
    const { result } = run('while(true){}', [], {}, { timeoutMs: 200, memoryMb: 32 });
    await expect(result).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  }, 5000);

  it('rejects a large allocation on the memory limit', async () => {
    const { result } = run(
      "const s = 'x'.repeat(256 * 1024 * 1024); return [{ json: { len: s.length } }];",
      [],
      {},
      { timeoutMs: 2000, memoryMb: 16 },
    );
    await expect(result).rejects.toThrow();
  }, 5000);
});

describe('runScript — return normalization (toItems semantics)', () => {
  it('a bare object → a single wrapped item', async () => {
    const { result } = run('return { a: 1 };');
    expect(await result).toEqual([{ json: { a: 1 } }]);
  });

  it('an array of plain objects → one item per object', async () => {
    const { result } = run('return [{ a: 1 }, { b: 2 }];');
    expect(await result).toEqual([{ json: { a: 1 } }, { json: { b: 2 } }]);
  });

  it('an array of WorkflowItems passes through', async () => {
    const { result } = run('return [{ json: { a: 1 } }];');
    expect(await result).toEqual([{ json: { a: 1 } }]);
  });

  it('no return / undefined → []', async () => {
    const { result } = run('const x = 1;');
    expect(await result).toEqual([]);
  });

  it('a rows envelope → one item per row', async () => {
    const { result } = run('return { rows: [{ a: 1 }, { a: 2 }] };');
    expect(await result).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });
});
