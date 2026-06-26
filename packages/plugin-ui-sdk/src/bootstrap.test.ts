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

  it('defines window.openldr SYNCHRONOUSLY (before any openldr:init) so screens never race the injection', () => {
    // Run the bootstrap IIFE against a controlled fake window, capturing the message handler.
    let handler: ((ev: unknown) => void) | undefined;
    const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', SDK_BOOTSTRAP_V1)(win);

    // The binding + its api surface + the ready promise exist immediately — no init yet.
    const api = (win as unknown as { openldr?: Record<string, unknown> }).openldr;
    expect(api).toBeTruthy();
    expect(api!.ready).toBeInstanceOf(Promise);
    expect(typeof (api!.storage as Record<string, unknown>).get).toBe('function');
    expect(typeof (api!.connectors as Record<string, unknown>).metadata).toBe('function');
    expect(api!.pluginId).toBe(''); // placeholder until init populates context
    expect(handler).toBeTypeOf('function');
  });

  it('populates context + resolves ready when openldr:init arrives', async () => {
    let handler: ((ev: unknown) => void) | undefined;
    const win = { addEventListener: (t: string, h: (ev: unknown) => void) => { if (t === 'message') handler = h; } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('window', SDK_BOOTSTRAP_V1)(win);
    const api = (win as unknown as { openldr: Record<string, unknown> }).openldr;

    const port = { start: () => {}, postMessage: () => {}, onmessage: null as unknown };
    handler!({ data: { type: 'openldr:init', context: { pluginId: 'dhis2-sink', locale: 'fr', capabilities: ['host:connectors'] } }, ports: [port] });

    await expect(api.ready).resolves.toBeUndefined();
    expect(api.pluginId).toBe('dhis2-sink');
    expect(api.locale).toBe('fr');
    expect(api.capabilities).toEqual(['host:connectors']);
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
