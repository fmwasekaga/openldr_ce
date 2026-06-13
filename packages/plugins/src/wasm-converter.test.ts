import { describe, it, expect, vi } from 'vitest';
import { createWasmConverter } from './wasm-converter';
import { parseManifest } from './manifest';
import type { PluginRunner } from './runner';

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
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
});
