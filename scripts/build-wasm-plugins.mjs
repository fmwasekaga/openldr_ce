// Builds the WHONET reference plugin to wasm and stages plugin.wasm + manifest.json
// under reference-plugins/whonet-sqlite/.
//
// Toolchain env (overridable): the wasm build of rusqlite's bundled SQLite needs
// clang + a WASI sysroot. Defaults below match the documented dev setup
// (LLVM via winget + the wasi-sdk sysroot under ~/.wasi-sdk). Override any of
// CLANG_BIN / WASI_SYSROOT / CC_wasm32_wasip1 / AR_wasm32_wasip1 via the environment.
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

const root = process.cwd();
const wasmDir = join(root, 'wasm');
const outDir = join(root, 'reference-plugins', 'whonet-sqlite');

const clangBin = process.env.CLANG_BIN ?? 'C:\\Program Files\\LLVM\\bin';
const wasiSysroot = process.env.WASI_SYSROOT ?? join(homedir(), '.wasi-sdk', 'wasi-sysroot-33.0+m');

const env = {
  ...process.env,
  PATH: `${clangBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
  CC_wasm32_wasip1: process.env.CC_wasm32_wasip1 ?? 'clang',
  AR_wasm32_wasip1: process.env.AR_wasm32_wasip1 ?? 'llvm-ar',
  WASI_SYSROOT: wasiSysroot,
};

if (!existsSync(wasiSysroot)) {
  process.stderr.write(
    `WASI sysroot not found at ${wasiSysroot}. Install the wasi-sdk sysroot and/or set WASI_SYSROOT.\n`,
  );
  process.exit(1);
}

execSync('cargo build -p whonet-sqlite --release --target wasm32-wasip1', { cwd: wasmDir, stdio: 'inherit', env });

const builtWasm = join(wasmDir, 'target', 'wasm32-wasip1', 'release', 'whonet_sqlite.wasm');
mkdirSync(outDir, { recursive: true });
const stagedWasm = join(outDir, 'plugin.wasm');
copyFileSync(builtWasm, stagedWasm);

const bytes = readFileSync(stagedWasm);
const sha = createHash('sha256').update(bytes).digest('hex');
// Version comes from the workspace package version in wasm/Cargo.toml.
const workspaceToml = readFileSync(join(wasmDir, 'Cargo.toml'), 'utf8');
const ver = (workspaceToml.match(/version\s*=\s*"([^"]+)"/) || [])[1] || '0.1.0';

const manifest = {
  id: 'whonet-sqlite',
  version: ver,
  entrypoint: 'convert',
  wasmSha256: sha,
  description: 'WHONET SQLite -> FHIR R4 AMR reference plugin',
  license: 'Apache-2.0',
  // SQLite (bundled, wasm32-wasip1) imports wasi_snapshot_preview1 (clock/random/fd),
  // so the sandbox must enable WASI even though the plugin reads from memory.
  wasi: true,
  limits: { memoryMb: 256, timeoutMs: 30000 },
};
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(`staged ${stagedWasm} (sha256 ${sha}) + manifest.json\n`);
