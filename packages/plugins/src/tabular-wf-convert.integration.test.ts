import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createExtismRunner } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

// reference-plugins/tabular/plugin.wasm is a (re)built bundle exposing the
// `wf_convert` (bytes ABI) entrypoint: raw CSV/Excel bytes + Extism config
// { output:'rows'|'fhir', mapping?, sheet? } -> { items: [{ json }] }.
// If the bundle is absent ⇒ the whole suite skips.
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'tabular', 'plugin.wasm');
const present = existsSync(wasmPath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

function sink() {
  const wasm = new Uint8Array(readFileSync(wasmPath));
  // kind:'source' + entrypoints:['wf_convert'] ⇒ the invoke allowlist permits wf_convert.
  const manifest = parseManifest({
    id: 'tabular', version: '0.1.0', kind: 'source', entrypoint: 'convert',
    entrypoints: ['wf_convert'], wasmSha256: sha256Hex(wasm), wasi: true,
  });
  // No net-egress needed: the converter only reads input bytes + emits FHIR/rows.
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, []);
}

describe.skipIf(!present)('tabular wf_convert through the real Extism runner (bytes ABI)', () => {
  it('output=rows → header-keyed cell objects (no mapping needed)', async () => {
    // reader trims headers/cells; each Row -> { header: cell } JSON object.
    const csv = new TextEncoder().encode('a,b\n1,2\n3,4\n');
    const rows = (await sink().invokeBytes('wf_convert', csv, { config: { output: 'rows' } })) as {
      items: { json: Record<string, string> }[];
    };
    expect(rows.items).toHaveLength(2);
    expect(rows.items[0].json).toEqual({ a: '1', b: '2' });
    expect(rows.items[1].json).toEqual({ a: '3', b: '4' });
  });

  it('output=fhir + a valid mapping → emits FHIR resources', async () => {
    const csv = new TextEncoder().encode('a,b\n1,2\n3,4\n');
    // Minimal valid Mapping over columns a/b: patientId+specimenId are required
    // (non-empty) and the validator demands organism OR antibiotics. Mapping
    // organism to column `a` makes each row emit Patient + Specimen + Observation.
    const mapping = JSON.stringify({ patientId: 'a', specimenId: 'b', organism: 'a' });
    const fhir = (await sink().invokeBytes('wf_convert', csv, { config: { output: 'fhir', mapping } })) as {
      items: { json: { resourceType?: string } }[];
    };
    expect(fhir.items.length).toBeGreaterThan(0);
    expect(fhir.items[0].json.resourceType).toBeTruthy(); // FHIR resource
    expect(fhir.items.some((i) => i.json.resourceType === 'Patient')).toBe(true);
  });

  it('output=fhir without a mapping → errors', async () => {
    const csv = new TextEncoder().encode('a,b\n1,2\n');
    await expect(
      sink().invokeBytes('wf_convert', csv, { config: { output: 'fhir' } }),
    ).rejects.toThrow();
  });
});
