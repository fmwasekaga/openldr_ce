import { describe, it, expect, vi } from 'vitest';
import { currentInFlight } from '@openldr/core';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import type { PluginRunner } from './runner';

const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;
const sinkManifest = parseManifest({
  id: 'dhis2-sink', version: '0.1.0', kind: 'sink',
  entrypoints: ['health_check', 'push_aggregate'], wasmSha256: 'a'.repeat(64),
});
const enc = (s: string) => new TextEncoder().encode(s);

function runnerReturning(text: string): PluginRunner {
  return { run: vi.fn(async () => enc(text)) };
}

describe('createWasmSink', () => {
  it('serializes input to JSON, invokes the named entrypoint, parses JSON output', async () => {
    const runner = runnerReturning('{"ok":true,"version":"2.40"}');
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runner, logger);
    const out = await sink.invoke('health_check', { ping: 1 });
    expect(out).toEqual({ ok: true, version: '2.40' });
    const call = (runner.run as any).mock.calls[0];
    expect(call[2].entrypoint).toBe('health_check');
    expect(new TextDecoder().decode(call[1])).toBe('{"ping":1}');
  });

  it('returns {} for empty/blank output', async () => {
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runnerReturning('  \n'), logger);
    expect(await sink.invoke('health_check', {})).toEqual({});
  });

  it('rejects an unknown entrypoint without calling the runner', async () => {
    const runner = runnerReturning('{}');
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runner, logger);
    await expect(sink.invoke('drop_table', {})).rejects.toThrow(/unknown entrypoint/);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('throws a clear error on invalid JSON output', async () => {
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runnerReturning('not json'), logger);
    await expect(sink.invoke('health_check', {})).rejects.toThrow(/invalid JSON/);
  });

  it('passes config and pinned allowedHosts through to the runner', async () => {
    const grant = [{ kind: 'net-egress', allowedHosts: [] }] as any;
    const runner = runnerReturning('{}');
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runner, logger, grant);
    await sink.invoke('push_aggregate', { rows: [] }, { config: { baseUrl: 'https://x' }, allowedHosts: ['x:443'] });
    const opts = (runner.run as any).mock.calls[0][2];
    expect(opts.config).toEqual({ baseUrl: 'https://x' });
    expect(opts.allowedHosts).toEqual(['x:443']);
  });

  it('fail-closes when a host is pinned but the plugin lacks net-egress', async () => {
    const grant = [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }] as any; // no net-egress
    const runner = runnerReturning('{}');
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runner, logger, grant);
    await expect(sink.invoke('push_aggregate', {}, { allowedHosts: ['x:443'] })).rejects.toThrow(/net-egress/);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('allows dry-run (no pinned host) even without net-egress', async () => {
    const grant = [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }] as any;
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runnerReturning('{"payload":{"dataValues":[]}}'), logger, grant);
    expect(await sink.invoke('push_aggregate', { rows: [] })).toEqual({ payload: { dataValues: [] } });
  });

  it('does not gate egress for a legacy (undefined) grant — passes hosts through', async () => {
    const runner = runnerReturning('{}');
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runner, logger); // no grant -> legacy/unrestricted
    await sink.invoke('push_aggregate', {}, { allowedHosts: ['x:443'] });
    expect((runner.run as any).mock.calls[0][2].allowedHosts).toEqual(['x:443']);
  });

  it('marks the op in-flight (pluginId + entrypoint) while the wasm runs and clears it after', async () => {
    let seenDuringRun: ReturnType<typeof currentInFlight> = [];
    const runner: PluginRunner = {
      run: vi.fn(async () => {
        seenDuringRun = currentInFlight();
        return enc('{}');
      }),
    };
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runner, logger);
    await sink.invoke('health_check', {});
    expect(seenDuringRun.some((o) => o.pluginId === 'dhis2-sink' && o.entrypoint === 'health_check')).toBe(true);
    // Cleared once the call completes — no leak into the registry.
    expect(currentInFlight().some((o) => o.pluginId === 'dhis2-sink' && o.entrypoint === 'health_check')).toBe(false);
  });

  it('clears the in-flight op even when the runner throws', async () => {
    const runner: PluginRunner = { run: vi.fn(async () => { throw new Error('worker died'); }) };
    const sink = createWasmSink(sinkManifest, new Uint8Array(), runner, logger);
    await expect(sink.invoke('health_check', {})).rejects.toThrow(/worker died/);
    expect(currentInFlight().some((o) => o.pluginId === 'dhis2-sink' && o.entrypoint === 'health_check')).toBe(false);
  });
});

describe('invokeBytes', () => {
  it('passes raw bytes to the runner and parses the JSON result', async () => {
    let received: Uint8Array | undefined;
    const runner = { run: async (_w: Uint8Array, input: Uint8Array) => { received = input; return new TextEncoder().encode('{"items":[{"json":{"line":"a"}}]}'); } };
    const manifest = parseManifest({ id: 'p', version: '1.0.0', kind: 'sink', entrypoints: ['wf_convert'], wasmSha256: 'a'.repeat(64) });
    const sink = createWasmSink(manifest, new Uint8Array([1, 2, 3]), runner as never, logger, []);
    const out = await sink.invokeBytes('wf_convert', new Uint8Array([9, 9]));
    expect(Array.from(received!)).toEqual([9, 9]);   // raw bytes, NOT JSON-encoded
    expect(out).toEqual({ items: [{ json: { line: 'a' } }] });
  });
  it('rejects an unknown entrypoint', async () => {
    const runner = { run: async () => new Uint8Array() };
    const manifest = parseManifest({ id: 'p', version: '1.0.0', kind: 'sink', entrypoints: ['wf_convert'], wasmSha256: 'a'.repeat(64) });
    const sink = createWasmSink(manifest, new Uint8Array(), runner as never, logger, []);
    await expect(sink.invokeBytes('nope', new Uint8Array())).rejects.toThrow(/unknown entrypoint/);
  });
});
