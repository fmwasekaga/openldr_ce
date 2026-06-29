import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createExtismRunner } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

// reference-plugins/test-sink/plugin.wasm is a gitignored build artifact
// (run `node scripts/build-test-sink.mjs` first). Absent ⇒ this suite skips.
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'test-sink', 'plugin.wasm');
const present = existsSync(wasmPath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

function sink() {
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const manifest = parseManifest({
    id: 'test-sink', version: '0.1.0', kind: 'sink',
    entrypoints: ['health_check', 'push_aggregate', 'wf_echo'],
    wasmSha256: sha256Hex(wasm), wasi: true,
  });
  // Empty grant: no net-egress needed for wf_echo (foreground, no host pinned).
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, []);
}

describe.skipIf(!present)('test-sink wf_echo through the real Extism runner (workflow-node ABI)', () => {
  it('echoes items and reports count + config in meta', async () => {
    const out = (await sink().invoke('wf_echo', {
      items: [{ json: { a: 1 } }, { json: { a: 2 } }],
      config: { note: 'hello' },
    })) as { items: { json: Record<string, unknown> }[]; meta: { count: number; config: Record<string, unknown> } };
    expect(out.items).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
    expect(out.meta.count).toBe(2);
    expect(out.meta.config).toEqual({ note: 'hello' });
  });
});
