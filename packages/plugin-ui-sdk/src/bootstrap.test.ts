import { describe, it, expect } from 'vitest';
import { SDK_BOOTSTRAP_V1, makeRpc } from './bootstrap';

describe('SDK_BOOTSTRAP_V1', () => {
  it('is a self-invoking script string referencing the init handshake + api surface', () => {
    expect(typeof SDK_BOOTSTRAP_V1).toBe('string');
    expect(SDK_BOOTSTRAP_V1.length).toBeGreaterThan(100);
    expect(SDK_BOOTSTRAP_V1).toContain('openldr:init');
    expect(SDK_BOOTSTRAP_V1).toContain('window.openldr');
    expect(SDK_BOOTSTRAP_V1).toMatch(/ready/);
    expect(SDK_BOOTSTRAP_V1).toMatch(/ports\[0\]/);
  });
});

describe('makeRpc', () => {
  it('correlates RPC by id and resolves per the host result', async () => {
    const sent: unknown[] = [];
    const fakePort = { postMessage: (m: unknown) => sent.push(m), onmessage: null as null | ((e: { data: unknown }) => void) };
    const rpc = makeRpc(fakePort as never);
    const p = rpc.call({ kind: 'reports.list' });
    const req = sent[0] as { id: number };
    fakePort.onmessage?.({ data: { id: req.id, result: { ok: true, data: [{ id: 'r1' }] } } });
    expect(await p).toEqual([{ id: 'r1' }]);
  });
  it('rejects when the host result is not ok', async () => {
    const sent: unknown[] = [];
    const fakePort = { postMessage: (m: unknown) => sent.push(m), onmessage: null as null | ((e: { data: unknown }) => void) };
    const rpc = makeRpc(fakePort as never);
    const p = rpc.call({ kind: 'reports.list' });
    const req = sent[0] as { id: number };
    fakePort.onmessage?.({ data: { id: req.id, result: { ok: false, error: 'denied' } } });
    await expect(p).rejects.toThrow(/denied/);
  });
  it('ignores replies with no matching id', async () => {
    const sent: unknown[] = [];
    const fakePort = { postMessage: (m: unknown) => sent.push(m), onmessage: null as null | ((e: { data: unknown }) => void) };
    const rpc = makeRpc(fakePort as never);
    const p = rpc.call({ kind: 'reports.list' });
    fakePort.onmessage?.({ data: { id: 999, result: { ok: true, data: 'wrong' } } }); // unknown id, ignored
    const req = sent[0] as { id: number };
    fakePort.onmessage?.({ data: { id: req.id, result: { ok: true, data: 'right' } } });
    expect(await p).toBe('right');
  });
});
