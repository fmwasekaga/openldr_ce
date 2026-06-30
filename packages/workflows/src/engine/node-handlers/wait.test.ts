import { describe, it, expect } from 'vitest';
import { waitHandler, resolveWaitMs } from './wait';
import { createContext } from '../execution-context';

describe('resolveWaitMs', () => {
  it('converts units to ms', () => {
    expect(resolveWaitMs({ duration: 250, unit: 'ms' })).toBe(250);
    expect(resolveWaitMs({ duration: 2, unit: 's' })).toBe(2000);
    expect(resolveWaitMs({ duration: 0.5, unit: 'm' })).toBe(30000);
  });

  it('defaults missing unit to seconds', () => {
    expect(resolveWaitMs({ duration: 1 })).toBe(1000);
  });

  it('clamps to 30s', () => {
    expect(resolveWaitMs({ duration: 40, unit: 's' })).toBe(30000);
    expect(resolveWaitMs({ duration: 10, unit: 'm' })).toBe(30000);
  });

  it('treats NaN / negative / missing as 0', () => {
    expect(resolveWaitMs({ duration: -5, unit: 's' })).toBe(0);
    expect(resolveWaitMs({ duration: 'oops' as unknown as number })).toBe(0);
    expect(resolveWaitMs({})).toBe(0);
  });
});

describe('waitHandler', () => {
  it('passes input items through unchanged (0ms = no sleep)', async () => {
    const ctx = createContext(undefined, () => {});
    const input = [{ json: { a: 1 } }, { json: { b: 2 } }];
    const out = await waitHandler(
      { id: 'w', type: 'action', data: { action: 'wait', config: { duration: 0, unit: 's' } } },
      ctx,
      input,
    );
    expect(out).toBe(input);
  });

  it('actually waits for a small positive duration then returns input', async () => {
    const ctx = createContext(undefined, () => {});
    const input = [{ json: { a: 1 } }];
    const start = Date.now();
    const out = await waitHandler(
      { id: 'w', type: 'action', data: { action: 'wait', config: { duration: 5, unit: 'ms' } } },
      ctx,
      input,
    );
    expect(Date.now() - start).toBeGreaterThanOrEqual(4);
    expect(out).toBe(input);
  });
});
