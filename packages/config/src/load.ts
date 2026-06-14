import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigError } from '@openldr/core';
import { ConfigSchema, type Config } from './schema';

let dotenvLoaded = false;

/**
 * Find the nearest `.env` by walking up from the current working directory.
 * dotenv only reads `.env` from cwd, so launching the server/CLI from a package
 * subdirectory (e.g. `pnpm --filter @openldr/server start`, whose cwd is
 * `apps/server/`) would otherwise miss the repo-root `.env` and fail with
 * "Required" config errors. Returns undefined if none is found (dotenv then
 * falls back to its default cwd lookup).
 */
function findEnvPath(): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env && !dotenvLoaded) {
    const envPath = findEnvPath();
    loadDotenv(envPath ? { path: envPath } : undefined);
    dotenvLoaded = true;
  }
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ConfigError(`Invalid configuration: ${issues}`);
  }
  return Object.freeze(parsed.data);
}
