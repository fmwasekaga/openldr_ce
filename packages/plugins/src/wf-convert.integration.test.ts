import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createExtismRunner } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'test-sink', 'plugin.wasm');
const present = existsSync(wasmPath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

function sink() {
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const manifest = parseManifest({ id: 'test-sink', version: '0.1.0', kind: 'sink', entrypoints: ['health_check', 'push_aggregate', 'wf_echo', 'wf_convert'], wasmSha256: sha256Hex(wasm), wasi: true });
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, []);
}

describe.skipIf(!present)('test-sink wf_convert through the real Extism runner (bytes ABI)', () => {
  it('parses raw bytes (lines) into items', async () => {
    const bytes = new TextEncoder().encode('alpha\nbeta\n\ngamma\n');
    const out = (await sink().invokeBytes('wf_convert', bytes)) as { items: { json: { line: string } }[] };
    expect(out.items).toEqual([{ json: { line: 'alpha' } }, { json: { line: 'beta' } }, { json: { line: 'gamma' } }]);
  });
});
