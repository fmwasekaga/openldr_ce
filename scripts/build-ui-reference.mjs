// Stages the ui-reference plugin under reference-plugins/ui-reference/.
// Reuses the test-sink wasm (build:test-sink must run first) so no Rust build is needed.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'reference-plugins', 'ui-reference');
mkdirSync(outDir, { recursive: true });

const srcWasm = join(root, 'reference-plugins', 'test-sink', 'plugin.wasm');
if (!existsSync(srcWasm)) { console.error('Build test-sink first: pnpm build:test-sink'); process.exit(1); }
const stagedWasm = join(outDir, 'plugin.wasm');
copyFileSync(srcWasm, stagedWasm);
const wasmSha = createHash('sha256').update(readFileSync(stagedWasm)).digest('hex');

const uiHtml = readFileSync(join(outDir, 'ui.html'));
const uiSha = createHash('sha256').update(uiHtml).digest('hex');

const manifest = {
  id: 'ui-reference',
  version: '0.1.0',
  kind: 'sink',
  entrypoints: ['health_check', 'push_aggregate'],
  wasmSha256: wasmSha,
  description: 'Reference plugin proving the plugin-UI surface (panel + datastore + gated host service)',
  license: 'Apache-2.0',
  wasi: true,
  limits: { memoryMb: 256, timeoutMs: 30000 },
  capabilities: [{ kind: 'host:reports' }],
  ui: { entry: 'ui.html', sha256: uiSha, nav: { label: 'Reference Plugin', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1' },
};
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('staged reference-plugins/ui-reference (wasm', wasmSha.slice(0, 12), 'ui', uiSha.slice(0, 12), ')');
