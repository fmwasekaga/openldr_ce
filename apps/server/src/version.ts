import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Resolve the app version. Prefers the APP_VERSION env (set at Docker build), else reads the
 * nearest package.json version by walking up from this module — works in dev (apps/server/src)
 * and in the bundled server. Falls back to '0.0.0' if nothing is found.
 */
export function readAppVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../package.json'), // dev: apps/server/src -> repo root
    resolve(here, '../../package.json'),
    resolve(here, '../package.json'),       // bundled server dir
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8')) as { version?: string; name?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // try next candidate
    }
  }
  return '0.0.0';
}
