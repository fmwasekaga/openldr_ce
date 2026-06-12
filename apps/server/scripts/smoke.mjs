// Build-artifact smoke check (P1: "build artifacts must be RUN, not just built").
//
// The server is bundled to ESM by tsup; bundled CJS deps (e.g. dotenv) call
// require() at runtime, which esbuild's __require polyfill rejects with
// "Dynamic require of X is not supported" unless tsup.config.ts installs a
// createRequire shim. That failure happens at MODULE LOAD, before the port is
// bound — so it is invisible to source-mode (tsx) dev and tests, and only the
// built dist artifact reveals it.
//
// This check spawns the built binary and fails loudly iff that marker appears.
// A clean start (binds the port) or a config/env error are both PASS — we are
// only asserting the artifact LOADS, not that infra is up.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '..', 'dist', 'index.js');
const MARKER = 'Dynamic require of';
const GRACE_MS = 4000;

const child = spawn(process.execPath, [entry], { stdio: ['ignore', 'pipe', 'pipe'] });
let buf = '';
child.stdout.on('data', (d) => (buf += d));
child.stderr.on('data', (d) => (buf += d));

let settled = false;
const finish = (reason) => {
  if (settled) return;
  settled = true;
  if (buf.includes(MARKER)) {
    process.stderr.write(
      `\n[smoke] FAIL: built server binary crashed at startup with a dynamic-require error.\n` +
        `This means the tsup createRequire shim is missing or broken.\n\n${buf}\n`,
    );
    try {
      child.kill('SIGKILL');
    } catch {}
    process.exit(1);
  }
  process.stderr.write(`[smoke] OK: server binary loaded without a dynamic-require error (${reason}).\n`);
  try {
    child.kill('SIGKILL');
  } catch {}
  process.exit(0);
};

// Either it exits fast (require crash or config error) or it survives long
// enough to prove it loaded cleanly and started binding.
child.on('exit', () => finish('process exited'));
child.on('error', (err) => {
  process.stderr.write(`[smoke] FAIL: could not spawn built binary: ${String(err)}\n`);
  process.exit(1);
});
setTimeout(() => finish('survived startup grace period'), GRACE_MS);
