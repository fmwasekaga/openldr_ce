// Builds the dhis2-sink plugin to wasm and stages plugin.wasm + manifest.json under
// reference-plugins/dhis2-sink/. Pure Rust (no C deps) so it needs only the
// wasm32-wasip1 target — no clang/WASI sysroot.
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = process.cwd();
const wasmDir = join(root, 'wasm');

execSync('cargo build -p dhis2-sink --release --target wasm32-wasip1', { cwd: wasmDir, stdio: 'inherit', env: process.env });

const built = join(wasmDir, 'target', 'wasm32-wasip1', 'release', 'dhis2_sink.wasm');
const dir = join(root, 'reference-plugins', 'dhis2-sink');
mkdirSync(dir, { recursive: true });
const staged = join(dir, 'plugin.wasm');
copyFileSync(built, staged);

const sha = createHash('sha256').update(readFileSync(staged)).digest('hex');
const workspaceToml = readFileSync(join(wasmDir, 'Cargo.toml'), 'utf8');
const ver = (workspaceToml.match(/version\s*=\s*"([^"]+)"/) || [])[1] || '0.1.0';

const manifest = {
  id: 'dhis2-sink',
  version: ver,
  kind: 'sink',
  entrypoints: ['health_check', 'pull_metadata', 'push_aggregate', 'push_tracker'],
  wasmSha256: sha,
  description: 'DHIS2 aggregate + tracker sink (mapping, metadata, push)',
  license: 'Apache-2.0',
  // wasm32-wasip1's std imports wasi_snapshot_preview1 even for HTTP-only plugins.
  wasi: true,
  limits: { memoryMb: 256, timeoutMs: 30000 },
  // Declares net-egress intent. The empty allowedHosts list means "the host pins the
  // concrete DHIS2 host at runtime" (the connector's baseUrl) — see the SP-1 egress model.
  capabilities: [{ kind: 'net-egress', allowedHosts: [] }],
};

// Ship the operator guide as the signed readme; inline ./img/*.png as data: URIs so it is self-contained.
const docsDir = join(wasmDir, 'dhis2-sink', 'docs');
let readme = readFileSync(join(docsDir, 'README.md'), 'utf8');
readme = readme.replace(/\]\(\.\/img\/([\w.-]+)\)/g, (_m, file) => {
  const ext = file.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'application/octet-stream';
  const b64 = readFileSync(join(docsDir, 'img', file)).toString('base64');
  return `](data:${mime};base64,${b64})`;
});
manifest.readme = readme;

writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(`staged ${staged} (sha256 ${sha}) + manifest.json\n`);
