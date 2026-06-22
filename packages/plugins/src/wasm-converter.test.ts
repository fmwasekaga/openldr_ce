import { describe, it, expect, vi } from 'vitest';
import { createWasmConverter } from './wasm-converter';
import { parseManifest } from './manifest';
import type { PluginRunner } from './runner';

const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;
const manifest = parseManifest({ id: 'demo', version: '0.1.0', wasmSha256: 'a'.repeat(64) });
const enc = (s: string) => new TextEncoder().encode(s);

function runnerReturning(text: string): PluginRunner {
  return { run: vi.fn(async () => enc(text)) };
}

describe('WasmPluginConverter', () => {
  it('parses NDJSON output into validated resources', async () => {
    const ndjson = '{"resourceType":"Patient","id":"p1"}\n{"resourceType":"Organization","id":"o1","name":"L"}\n';
    const c = createWasmConverter(manifest, new Uint8Array(), runnerReturning(ndjson), logger);
    const out = await c.convert(enc('input'), { batchId: 'b1' });
    expect(out).toHaveLength(2);
    expect(out[0].resourceType).toBe('Patient');
    expect(c.id).toBe('demo');
    expect(c.version).toBe('0.1.0');
  });

  it('ignores blank lines and returns empty for empty output', async () => {
    const c = createWasmConverter(manifest, new Uint8Array(), runnerReturning('\n  \n'), logger);
    expect(await c.convert(enc('x'), { batchId: 'b1' })).toEqual([]);
  });

  it('throws when the plugin emits invalid FHIR', async () => {
    const c = createWasmConverter(manifest, new Uint8Array(), runnerReturning('{"foo":1}\n'), logger);
    await expect(c.convert(enc('x'), { batchId: 'b1' })).rejects.toThrow(/invalid FHIR/);
  });

  it('passes ctx.config through to the runner', async () => {
    let seen: Record<string, string> | undefined;
    const runner: PluginRunner = {
      async run(_wasm, _input, opts) { seen = opts.config; return new TextEncoder().encode(''); },
    };
    const conv = createWasmConverter(manifest, new Uint8Array(), runner, logger);
    await conv.convert(new Uint8Array(), { batchId: 'b1', config: { mapping: '{"x":1}' } });
    expect(seen).toEqual({ mapping: '{"x":1}' });
  });
});

// ── Task 7: enforcement tests ─────────────────────────────────────────────────

const manifestEnforce = { id: 'p', version: '1.0.0', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), description: '', license: 'x', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } } as any;

function runnerEmitting(resources: object[]): PluginRunner {
  const ndjson = resources.map((r) => JSON.stringify(r)).join('\n');
  return { run: vi.fn(async () => new TextEncoder().encode(ndjson)) };
}
const patient = { resourceType: 'Patient', id: 'p1' };
const obs = { resourceType: 'Observation', id: 'o1', status: 'final', code: { text: 'x' } };

describe('wasm-converter enforcement', () => {
  it('legacy (no grant) is unrestricted', async () => {
    const c = createWasmConverter(manifestEnforce, new Uint8Array(), runnerEmitting([patient, obs]), logger, undefined);
    const out = await c.convert(new Uint8Array(), { batchId: 'b' });
    expect(out).toHaveLength(2);
  });
  it('emit-fhir allowlist passes in-grant resources', async () => {
    const grant = [{ kind: 'emit-fhir', resourceTypes: ['Patient', 'Observation'] }] as any;
    const c = createWasmConverter(manifestEnforce, new Uint8Array(), runnerEmitting([patient, obs]), logger, grant);
    expect(await c.convert(new Uint8Array(), { batchId: 'b' })).toHaveLength(2);
  });
  it('fails closed on an out-of-grant resourceType', async () => {
    const grant = [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }] as any;
    const c = createWasmConverter(manifestEnforce, new Uint8Array(), runnerEmitting([patient, obs]), logger, grant);
    await expect(c.convert(new Uint8Array(), { batchId: 'b' })).rejects.toThrow(/capability|not permitted|Observation/i);
  });
  it('an empty grant denies all emits', async () => {
    const c = createWasmConverter(manifestEnforce, new Uint8Array(), runnerEmitting([patient]), logger, []);
    await expect(c.convert(new Uint8Array(), { batchId: 'b' })).rejects.toThrow();
  });
  it('passes allowedHosts from a net-egress grant to the runner', async () => {
    const grant = [{ kind: 'net-egress', allowedHosts: ['ex.org:443'] }, { kind: 'emit-fhir', resourceTypes: ['Patient'] }] as any;
    const runner = runnerEmitting([patient]);
    const c = createWasmConverter(manifestEnforce, new Uint8Array(), runner, logger, grant);
    await c.convert(new Uint8Array(), { batchId: 'b' });
    expect((runner.run as any).mock.calls[0][2].allowedHosts).toEqual(['ex.org:443']);
  });
});
