import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createExtismRunner } from './extism-runner';
import { createWasmSink } from './wasm-sink';
import { parseManifest } from './manifest';
import { sha256Hex } from './hash';

// reference-plugins/test-sink/plugin.wasm is a gitignored build artifact (run
// `pnpm build:test-sink` first). When absent the whole suite is skipped so the
// hermetic gate stays green without the Rust/wasm toolchain.
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', '..', '..', 'reference-plugins', 'test-sink', 'plugin.wasm');
const present = existsSync(wasmPath);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;

describe.skipIf(!present)('test-sink through the real Extism runner', () => {
  it('health_check returns ok and push_aggregate echoes a dry-run payload', async () => {
    const wasm = new Uint8Array(readFileSync(wasmPath));
    const manifest = parseManifest({
      id: 'test-sink', version: '0.1.0', kind: 'sink',
      entrypoints: ['health_check', 'push_aggregate'], wasmSha256: sha256Hex(wasm), wasi: true,
    });
    const sink = createWasmSink(manifest, wasm, createExtismRunner(), logger);

    const health = await sink.invoke('health_check', {});
    expect(health).toMatchObject({ ok: true });

    const push = await sink.invoke('push_aggregate', { rows: [{ a: 1 }] });
    expect(push).toMatchObject({ payload: { dataValues: [] }, echo: { rows: [{ a: 1 }] } });
  });
});
