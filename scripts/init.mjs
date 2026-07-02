import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { select, input, confirm } from '@inquirer/prompts';
import { formatIpChoices, isValidFqdn } from './init/host-detect.mjs';
import { isPortFree } from './init/port-check.mjs';
import { computeEnv } from './init/config-compute.mjs';
import { mergeEnv } from './init/env-merge.mjs';
import { renderRealm } from './init/realm-render.mjs';
import { planCerts } from './init/certs.mjs';
import { launchStack } from './init/launch.mjs';
import { healthUrl, pollHealth } from './init/verify.mjs';

async function askPort(label, def) {
  for (;;) {
    const v = Number(await input({ message: `${label} port`, default: String(def) }));
    if (!Number.isInteger(v) || v < 1 || v > 65535) { console.log('  invalid port'); continue; }
    if (!(await isPortFree(v))) {
      const go = await confirm({ message: `port ${v} looks busy — use it anyway?`, default: false });
      if (!go) continue;
    }
    return v;
  }
}

async function main() {
  const kind = await select({ message: 'Address the server by', choices: [{ name: 'IP', value: 'ip' }, { name: 'Domain', value: 'domain' }] });
  let host;
  if (kind === 'ip') {
    const choices = formatIpChoices();
    host = await select({ message: 'Which address?', choices: [...choices.map((c) => ({ name: `${c.address} (${c.name})`, value: c.address })), { name: 'enter manually', value: '__manual__' }] });
    if (host === '__manual__') host = await input({ message: 'IP address' });
  } else {
    host = await input({ message: 'Domain (FQDN)', validate: (s) => isValidFqdn(s) || 'invalid hostname' });
  }

  const tlsMode = await select({ message: 'TLS', choices: [
    { name: 'Self-signed (lab/internal)', value: 'self-signed' },
    { name: "Let's Encrypt (public domain)", value: 'letsencrypt' },
    { name: 'Bring your own cert', value: 'byo' },
  ] });
  let email, certPath, keyPath;
  if (tlsMode === 'letsencrypt') email = await input({ message: "Email for Let's Encrypt" });
  if (tlsMode === 'byo') { certPath = await input({ message: 'fullchain cert path' }); keyPath = await input({ message: 'private key path' }); }

  const httpPort = await askPort('HTTP', 80);
  const httpsPort = await askPort('HTTPS', 443);

  const env = computeEnv({ host, tlsMode, httpPort, httpsPort, email });

  // .env.prod: create from example on first run, then merge (preserves secrets).
  if (!existsSync('.env.prod')) copyFileSync('.env.prod.example', '.env.prod');
  let envText = readFileSync('.env.prod', 'utf8');
  // Generate a persistent secrets-encryption key on first run (needed by connectors/DHIS2 secrets).
  // Idempotent: never rotate an existing key, so re-running init doesn't invalidate stored secrets.
  if (!/^SECRETS_ENCRYPTION_KEY=.+/m.test(envText)) {
    const key = randomBytes(32).toString('base64');
    envText = /^#?\s*SECRETS_ENCRYPTION_KEY=/m.test(envText)
      ? envText.replace(/^#?\s*SECRETS_ENCRYPTION_KEY=.*/m, `SECRETS_ENCRYPTION_KEY=${key}`)
      : `${envText}\nSECRETS_ENCRYPTION_KEY=${key}\n`;
  }
  writeFileSync('.env.prod', mergeEnv(envText, env));

  // rendered realm import
  mkdirSync('deploy/nginx/certs', { recursive: true });
  writeFileSync(
    'infra/keycloak/openldr-realm.json',
    renderRealm(readFileSync('infra/keycloak/openldr-realm.json.template', 'utf8'), env.PUBLIC_ORIGIN),
  );

  // certs
  const plan = planCerts({ tlsMode, host, email, certPath, keyPath });
  if (plan.kind === 'exec') execSync(plan.command, { stdio: 'inherit' });
  else if (plan.kind === 'copy') for (const f of plan.files) copyFileSync(f.from, f.to);
  else if (plan.kind === 'certbot') {
    // nginx must have a cert to start on :443, but certbot needs nginx (webroot) to issue the real
    // one — so bootstrap with a self-signed placeholder now; `pnpm run cert` swaps in the LE cert.
    execSync(planCerts({ tlsMode: 'self-signed', host }).command, { stdio: 'inherit' });
    console.log(`  Let's Encrypt selected: after this comes up, run \`pnpm run cert\` (ensure DNS for ${plan.domain} points here and port 80 is reachable).`);
  }

  console.log('\nLaunching the stack…');
  const code = launchStack();
  if (code !== 0) { console.error('docker compose up failed — see the output above.'); process.exit(code); }

  console.log('Waiting for /health…');
  const ok = await pollHealth(healthUrl(env.PUBLIC_ORIGIN, httpsPort));
  console.log(ok
    ? `\n✅ up.\n  landing: ${env.PUBLIC_ORIGIN}/\n  studio:  ${env.PUBLIC_ORIGIN}/studio\n  keycloak admin: ${env.PUBLIC_ORIGIN}/auth/admin`
    : '\n⚠ health did not go green in time — check `docker compose -f docker-compose.prod.yml logs`.');
}

main().catch((e) => { console.error(e); process.exit(1); });
