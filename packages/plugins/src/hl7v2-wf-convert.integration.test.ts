import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createExtismRunner } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

// reference-plugins/hl7v2/plugin.wasm is a (re)built bundle exposing the
// `wf_convert` (bytes ABI) entrypoint: raw HL7 v2 text bytes + Extism config
// { output:'rows'|'fhir', organismIdCodes?, astInterpretationCodes? } -> { items: [{ json }] }.
// If the wasm is absent ⇒ the whole suite skips.
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'hl7v2', 'plugin.wasm');
const present = existsSync(wasmPath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

// Valid ORU^R01 reused verbatim from wasm/hl7v2/src/mapping.rs host tests
// (`oru_maps_patient_specimen_organism_ast` + `project_row_flattens_key_fields`):
// known to parse + map under the crate's DEFAULT Config (organism `eco`, AST `R`).
// HL7 segments are \r-delimited.
const ORU =
  'MSH|^~\\&|LIS|LAB|||20260110||ORU^R01|1|P|2.5.1\r' +
  'PID|1||P001||Doe^Jane||19900101|F\r' +
  'PV1|1|I\r' +
  'SPM|1|||BLOOD|||||||||||||20260110\r' +
  'OBR|1||1|CULT^Culture\r' +
  'OBX|1|CWE|634-6^Bacteria identified||eco^Escherichia coli\r' +
  'OBX|2|ST|AMP^Ampicillin|||||R';

function sink() {
  const wasm = new Uint8Array(readFileSync(wasmPath));
  // kind:'source' + entrypoints:['wf_convert'] ⇒ the invoke allowlist permits wf_convert.
  const manifest = parseManifest({
    id: 'hl7v2', version: '0.1.0', kind: 'source', entrypoint: 'convert',
    entrypoints: ['wf_convert'], wasmSha256: sha256Hex(wasm), wasi: true,
  });
  // No net-egress needed: the converter only reads input bytes + emits FHIR/rows.
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, []);
}

describe.skipIf(!present)('hl7v2 wf_convert through the real Extism runner (bytes ABI)', () => {
  it('output=rows → emits one flat record per HL7 message (not FHIR)', async () => {
    const msg = new TextEncoder().encode(ORU);
    const rows = (await sink().invokeBytes('wf_convert', msg, { config: { output: 'rows' } })) as {
      items: { json: Record<string, unknown> }[];
    };
    expect(rows.items.length).toBeGreaterThan(0);
    expect(rows.items[0].json.resourceType).toBeUndefined(); // a flat row, not FHIR
    expect(Object.keys(rows.items[0].json).length).toBeGreaterThan(0); // has fields
  });

  it('output=fhir → emits FHIR resources from HL7 message bytes', async () => {
    const msg = new TextEncoder().encode(ORU);
    const fhir = (await sink().invokeBytes('wf_convert', msg, { config: { output: 'fhir' } })) as {
      items: { json: { resourceType?: string } }[];
    };
    expect(fhir.items.length).toBeGreaterThan(0);
    expect(fhir.items[0].json.resourceType).toBeTruthy(); // FHIR resource
  });
});
