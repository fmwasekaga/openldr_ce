// Builds the dhis2-sink plugin to wasm and stages plugin.wasm + manifest.json under
// reference-plugins/dhis2-sink/. Pure Rust (no C deps) so it needs only the
// wasm32-wasip1 target — no clang/WASI sysroot.
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { build as esbuild } from 'esbuild';

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

// Bundle the Preact SPA in-memory and inline it (JS + CSS) into a single ui.html.
// The host wraps ui.html (body content only) in a sandboxed iframe and injects window.openldr.
const uiSrc = join(wasmDir, 'dhis2-sink', 'ui', 'src');
const result = await esbuild({
  entryPoints: [join(uiSrc, 'main.tsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  target: 'es2020',
  write: false,
  logLevel: 'info',
});
const js = result.outputFiles[0].text;
const css = readFileSync(join(uiSrc, 'styles.css'), 'utf8');
const uiHtml = `<style>${css}</style><div id="app"></div><script>${js}</script>`;
writeFileSync(join(dir, 'ui.html'), uiHtml);
const uiSha = createHash('sha256').update(uiHtml).digest('hex');

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
  // host:* are the gated host-services the webview UI needs (reports/connectors/schedule/fhir).
  capabilities: [
    { kind: 'net-egress', allowedHosts: [] },
    { kind: 'host:reports' },
    { kind: 'host:connectors' },
    { kind: 'host:schedule' },
    { kind: 'host:fhir' },
  ],
  // Plugin-contributed UI: the host renders ui.html in a sandboxed iframe and contributes a nav entry.
  ui: { entry: 'ui.html', sha256: uiSha, nav: { label: 'DHIS2', icon: 'share-2', section: 'apps' }, uiSdkVersion: '1' },
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
process.stdout.write(`staged ${staged} (wasm ${sha.slice(0, 12)}, ui ${uiSha.slice(0, 12)}) + manifest.json + ui.html\n`);
