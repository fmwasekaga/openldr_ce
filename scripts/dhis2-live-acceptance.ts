// Runner for the live DHIS2 acceptance (SP-6). The actual checks live in the vitest
// integration test apps/server/src/dhis2-live.acceptance.test.ts — we launch them via
// vitest (NOT the tsx CLI) because the Extism worker-path HTTP egress crashes under
// tsx's source-map preflight but runs green under vitest. This runner only spawns a
// child process, so it never loads the Extism worker itself.
//
// Loads .env, sets DHIS2_LIVE=1, and runs the single skip-guarded test file.
// Run: pnpm dhis2:accept
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env loader (KEY=VALUE per line; does not override real process env). */
function loadDotenv(): Record<string, string> {
  const out: Record<string, string> = {};
  const file = join(repoRoot, '.env');
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!(key in process.env)) out[key] = line.slice(eq + 1).trim();
  }
  return out;
}

const env = { ...loadDotenv(), ...process.env, DHIS2_LIVE: '1' };
const res = spawnSync(
  'pnpm',
  ['-C', 'apps/server', 'exec', 'vitest', 'run', 'src/dhis2-live.acceptance.test.ts'],
  { cwd: repoRoot, env, stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(res.status ?? 1);
