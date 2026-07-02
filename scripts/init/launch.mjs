import { spawnSync } from 'node:child_process';

/** Bring the prod stack up (build + detached). Returns the process exit code. */
export function launchStack() {
  // `--env-file .env.prod`: compose resolves `${VAR}` substitutions (KC_HOSTNAME, SERVER_NAME,
  // gateway ports, POSTGRES_PASSWORD, S3 creds — the keycloak/nginx/postgres/minio services) from
  // this file. Without it compose reads only a `.env` (absent) and every backing service falls
  // back to its localhost/default value even though .env.prod is correct (the app is fine because
  // it uses `env_file:` directly). `-p openldr` keeps the project name stable across checkouts —
  // `pnpm run cert` / deploy/letsencrypt.sh and the docs all target this same project.
  const r = spawnSync('docker', ['compose', '--env-file', '.env.prod', '-f', 'docker-compose.prod.yml', '-p', 'openldr', 'up', '-d', '--build'], { stdio: 'inherit' });
  return r.status ?? 1;
}
