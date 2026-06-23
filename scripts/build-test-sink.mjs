// Builds the trivial test-sink plugin to wasm and stages plugin.wasm + manifest.json under
// reference-plugins/test-sink/. Pure Rust (no C deps) so it needs only the wasm32-wasip1
// target — no clang/WASI sysroot, unlike the whonet-sqlite build.
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = process.cwd();
const wasmDir = join(root, 'wasm');

execSync('cargo build -p test-sink --release --target wasm32-wasip1', { cwd: wasmDir, stdio: 'inherit', env: process.env });

const built = join(wasmDir, 'target', 'wasm32-wasip1', 'release', 'test_sink.wasm');
const dir = join(root, 'reference-plugins', 'test-sink');
mkdirSync(dir, { recursive: true });
const staged = join(dir, 'plugin.wasm');
copyFileSync(built, staged);

const sha = createHash('sha256').update(readFileSync(staged)).digest('hex');
const workspaceToml = readFileSync(join(wasmDir, 'Cargo.toml'), 'utf8');
const ver = (workspaceToml.match(/version\s*=\s*"([^"]+)"/) || [])[1] || '0.1.0';

const manifest = {
  id: 'test-sink',
  version: ver,
  kind: 'sink',
  entrypoints: ['health_check', 'push_aggregate'],
  wasmSha256: sha,
  description: 'Trivial sink ABI test plugin',
  license: 'Apache-2.0',
  // wasm32-wasip1's std imports wasi_snapshot_preview1 even for in-memory plugins.
  wasi: true,
  limits: { memoryMb: 256, timeoutMs: 30000 },
  // Declares net-egress intent (empty allowedHosts = host pins the concrete host at runtime).
  capabilities: [{ kind: 'net-egress', allowedHosts: [] }],
};
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(`staged ${staged} (sha256 ${sha}) + manifest.json\n`);
