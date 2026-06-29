import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createExtismRunner } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

// reference-plugins/dhis2-sink/plugin.wasm is a gitignored build artifact
// (run `pnpm build:dhis2-sink` first). Absent ⇒ the whole suite skips.
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'dhis2-sink', 'plugin.wasm');
const present = existsSync(wasmPath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

function sink() {
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const manifest = parseManifest({
    id: 'dhis2-sink', version: '0.1.0', kind: 'sink',
    entrypoints: ['health_check', 'pull_metadata', 'push_aggregate', 'push_tracker', 'wf_push'],
    wasmSha256: sha256Hex(wasm), wasi: true,
  });
  // Pass a net-egress grant so the push path is allowed once a host is pinned.
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, [{ kind: 'net-egress', allowedHosts: [] }]);
}

describe.skipIf(!present)('dhis2-sink wf_push through the real Extism runner (items envelope, dry-run)', () => {
  it('builds dataValues from items + mapping with no egress', async () => {
    const out = (await sink().invoke('wf_push', {
      items: [{ json: { facility: 'fac-1', tested: 4, r: 2 } }],
      config: {
        // Aggregate mapping intentionally has NO `kind` field → wf_push defaults to "aggregate".
        mapping: {
          orgUnitColumn: 'facility',
          columns: [
            { column: 'tested', dataElement: 'DE_TESTED' },
            { column: 'r', dataElement: 'DE_RESISTANT', categoryOptionCombo: 'COC_DEFAULT' },
          ],
        },
        orgUnitMap: { 'fac-1': 'OU_AAA' },
        period: '2026Q1',
        dryRun: true,
      },
    })) as { items: unknown[]; meta: { kind: string; dataValues: number; result: unknown } };
    expect(out.meta.kind).toBe('aggregate');
    expect(out.meta.dataValues).toBe(2);
    expect(out.meta.result).toBeNull();
    expect(out.items).toHaveLength(1);
  });
});
