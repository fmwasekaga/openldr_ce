import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createExtismRunner } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

// reference-plugins/whonet-sqlite/plugin.wasm is a (re)built bundle exposing the
// `wf_convert` (bytes ABI) entrypoint; samples/whonet-sample.sqlite is produced by
// `pnpm make:whonet-sample`. If either is absent ⇒ the whole suite skips.
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'whonet-sqlite', 'plugin.wasm');
const samplePath = join(here, '..', '..', '..', 'samples', 'whonet-sample.sqlite');
const present = existsSync(wasmPath) && existsSync(samplePath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

function sink() {
  const wasm = new Uint8Array(readFileSync(wasmPath));
  // kind:'source' + entrypoints:['wf_convert'] ⇒ the invoke allowlist permits wf_convert.
  const manifest = parseManifest({
    id: 'whonet-sqlite', version: '0.1.0', kind: 'source', entrypoint: 'convert',
    entrypoints: ['wf_convert'], wasmSha256: sha256Hex(wasm), wasi: true,
  });
  // No net-egress needed: the converter only reads input bytes + emits FHIR/rows.
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, []);
}

describe.skipIf(!present)('whonet wf_convert through the real Extism runner (bytes ABI)', () => {
  it('output=fhir → emits FHIR resources from WHONET SQLite bytes', async () => {
    const sampleBytes = new Uint8Array(readFileSync(samplePath));
    const fhir = (await sink().invokeBytes('wf_convert', sampleBytes, { config: { output: 'fhir' } })) as {
      items: { json: { resourceType?: string } }[];
    };
    expect(fhir.items.length).toBeGreaterThan(0);
    expect(fhir.items[0].json.resourceType).toBeTruthy(); // FHIR resource
  });

  it('output=rows → emits raw isolate rows (not FHIR)', async () => {
    const sampleBytes = new Uint8Array(readFileSync(samplePath));
    const rows = (await sink().invokeBytes('wf_convert', sampleBytes, { config: { output: 'rows' } })) as {
      items: { json: Record<string, unknown> }[];
    };
    expect(rows.items.length).toBeGreaterThan(0);
    expect(rows.items[0].json.resourceType).toBeUndefined(); // raw row, not FHIR
    expect(Object.keys(rows.items[0].json).length).toBeGreaterThan(0); // has columns
  });
});
