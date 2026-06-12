import { describe, it, expect } from 'vitest';
import type { HealthCheck, HealthResult } from '@openldr/ports';
import { HealthRegistry } from './health-registry';

function fake(name: string, result: HealthResult | (() => Promise<HealthResult>)): HealthCheck {
  return { name, check: typeof result === 'function' ? result : async () => result };
}

describe('HealthRegistry', () => {
  it('aggregates to up when all checks are up', async () => {
    const reg = new HealthRegistry();
    reg.register(fake('a', { status: 'up', latencyMs: 1 }));
    reg.register(fake('b', { status: 'up', latencyMs: 1 }));
    const out = await reg.runAll();
    expect(out.status).toBe('up');
    expect(Object.keys(out.checks)).toEqual(['a', 'b']);
  });

  it('aggregates to down when any check is down', async () => {
    const reg = new HealthRegistry();
    reg.register(fake('a', { status: 'up', latencyMs: 1 }));
    reg.register(fake('b', { status: 'down', latencyMs: 1, detail: 'boom' }));
    const out = await reg.runAll();
    expect(out.status).toBe('down');
    expect(out.checks.b.detail).toBe('boom');
  });

  it('treats a thrown check as down, not a crash', async () => {
    const reg = new HealthRegistry();
    reg.register(fake('a', async () => { throw new Error('explode'); }));
    const out = await reg.runAll();
    expect(out.status).toBe('down');
    expect(out.checks.a.status).toBe('down');
  });
});
