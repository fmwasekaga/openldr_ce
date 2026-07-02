import { spawnSync } from 'node:child_process';

/** Bring the prod stack up (build + detached). Returns the process exit code. */
export function launchStack() {
  // Explicit `-p openldr` so the project name is stable regardless of the checkout directory —
  // `pnpm run cert` / deploy/letsencrypt.sh and the docs all target this same project.
  const r = spawnSync('docker', ['compose', '-f', 'docker-compose.prod.yml', '-p', 'openldr', 'up', '-d', '--build'], { stdio: 'inherit' });
  return r.status ?? 1;
}
