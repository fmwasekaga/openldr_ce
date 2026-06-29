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
  const manifest = parseManifest({ id: 'test-sink', version: '0.1.0', kind: 'sink', entrypoints: ['health_check', 'push_aggregate', 'wf_echo', 'wf_convert', 'wf_emit'], wasmSha256: sha256Hex(wasm), wasi: true });
  return createWasmSink(manifest, wasm, createExtismRunner(), logger, []);
}

describe.skipIf(!present)('test-sink wf_emit through the real Extism runner (binary output)', () => {
  it('returns an item with inline base64 bytes', async () => {
    const out = (await sink().invoke('wf_emit', {})) as { items: { json: unknown; binary: { out: { contentType: string; fileName: string; dataBase64: string } } }[] };
    expect(out.items[0].binary.out).toEqual({ contentType: 'text/plain', fileName: 'hello.txt', dataBase64: 'aGVsbG8=' });
  });
});
