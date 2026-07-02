import { spawnSync } from 'node:child_process';

/** Bring the prod stack up (build + detached). Returns the process exit code. */
export function launchStack() {
  const r = spawnSync('docker', ['compose', '-f', 'docker-compose.prod.yml', 'up', '-d', '--build'], { stdio: 'inherit' });
  return r.status ?? 1;
}
