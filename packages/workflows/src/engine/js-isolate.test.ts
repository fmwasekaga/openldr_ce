import { describe, it, expect } from 'vitest';
import { evalExpression, type JsLimits } from './js-isolate';

const L: JsLimits = { timeoutMs: 1000, memoryMb: 16 };

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
});

describe('evalExpression — malformed source', () => {
  it('throws a clear Error on a syntax error', async () => {
    await expect(evalExpression('this is not js (', {}, L)).rejects.toThrow();
  });

  it('throws on a reference to an undefined identifier', async () => {
    await expect(evalExpression('someUndefinedThing.foo', {}, L)).rejects.toThrow();
  });
});
