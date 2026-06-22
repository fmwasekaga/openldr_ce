// Live marketplace acceptance for SP-2 — drives the REAL operator CLI end to end
// to demonstrate verify -> consent -> enforce -> lifecycle.
//
// Preconditions:
//   - Internal Postgres reachable (INTERNAL_DATABASE_URL, default the :5433 dev DB)
//   - `pnpm build:plugins` has produced reference-plugins/whonet-sqlite/plugin.wasm
//   - `pnpm make:marketplace-bundle` has written bundles into ../openldr-ce-marketplace
//   - samples/whonet-sample.sqlite exists (`pnpm make:whonet-sample`)
//
// Run: pnpm marketplace:accept
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const marketplaceRepo = join(repoRoot, '..', 'openldr-ce-marketplace');
const narrow = join(marketplaceRepo, 'bundles', 'whonet-narrow');
const wide = join(marketplaceRepo, 'bundles', 'whonet-wide');
const tamperDir = join(repoRoot, 'tmp-marketplace-tamper');
const sample = join(repoRoot, 'samples', 'whonet-sample.sqlite');

let failures = 0;
const step = (m: string) => console.log(`\n[${m}]`);
const ok = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => { failures++; console.error(`  ✗ FAIL: ${m}`); };

/** Run an openldr CLI command; never throws — returns the captured result. */
function cli(args: string): { code: number; out: string } {
  try {
    const out = execSync(`pnpm --silent openldr ${args}`, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}
function json(out: string): unknown {
  try { return JSON.parse(out.trim().split('\n').filter(Boolean).pop() ?? ''); } catch { return undefined; }
}

function main() {
  for (const [label, p] of [['narrow bundle', narrow], ['wide bundle', wide], ['whonet sample', sample]] as const) {
    if (!existsSync(p)) { console.error(`missing ${label} at ${p} — run make:marketplace-bundle / make:whonet-sample first`); process.exit(1); }
  }

  step('0. reset internal database');
  if (cli('db reset --json').code !== 0) { fail('db reset'); finish(); }
  ok('internal db reset + migrated');

  step('1. market verify (narrow) — signature + capability report');
  const v = cli(`market verify "${narrow}" --json`);
  const vj = json(v.out) as { valid?: boolean; capabilities?: unknown } | undefined;
  if (v.code === 0 && vj?.valid === true) ok(`bundle verifies; report: ${JSON.stringify(vj.capabilities)}`);
  else fail(`verify expected valid:true, got code=${v.code} out=${v.out}`);

  step('2. market install (narrow) WITH approval — consent + grant persisted + publisher pinned');
  const i = cli(`market install "${narrow}" --approve --approved-by accept --json`);
  if (i.code === 0) ok('installed with approval'); else fail(`install narrow: code=${i.code} out=${i.out}`);
  const list1 = json(cli('market list --json').out) as Array<{ id: string }> | undefined;
  if (Array.isArray(list1) && list1.some((r) => r.id === 'whonet-sqlite')) ok('whonet-sqlite present in market list'); else fail('whonet-sqlite not listed after install');

  step('3. tampered bundle — install MUST reject');
  rmSync(tamperDir, { recursive: true, force: true });
  mkdirSync(tamperDir, { recursive: true });
  for (const f of ['plugin.wasm', 'publisher.pub']) copyFileSync(join(narrow, f), join(tamperDir, f));
  const m = JSON.parse(readFileSync(join(narrow, 'manifest.json'), 'utf8')) as { description: string };
  m.description = `${m.description} (tampered)`; // mutate a signed field without re-signing
  writeFileSync(join(tamperDir, 'manifest.json'), JSON.stringify(m, null, 2));
  const t = cli(`market install "${tamperDir}" --approve --approved-by accept --json`);
  if (t.code !== 0) ok('tampered bundle rejected'); else fail('tampered bundle was NOT rejected');
  rmSync(tamperDir, { recursive: true, force: true });

  step('4. ingest under the narrow [Patient] grant — MUST fail closed');
  cli(`ingest "${sample}" --plugin whonet-sqlite --json`);
  const ps1 = json(cli('pipeline status --json').out) as Array<{ status: string; last_error?: string | null }> | undefined;
  const failedBatch = Array.isArray(ps1) ? ps1.find((b) => b.status === 'failed') : undefined;
  if (failedBatch) ok(`batch failed closed: ${failedBatch.last_error ?? '(capability violation)'}`);
  else fail(`expected a failed batch under the narrow grant; pipeline=${JSON.stringify(ps1)}`);

  step('5. update to the wide grant — re-ingest MUST succeed');
  // Install the wide bundle as an update (publisher already pinned from step 2 → trusted).
  // Do NOT reset the DB — this genuinely tests update-from-narrow, not a fresh install.
  const u = cli(`market install "${wide}" --approve --approved-by accept --json`);
  if (u.code !== 0) fail(`install wide: code=${u.code} out=${u.out}`); else ok('wide grant installed (update -> v1.1.0 active)');
  cli(`ingest "${sample}" --plugin whonet-sqlite --json`);
  const ps2 = json(cli('pipeline status --json').out) as Array<{ status: string; resource_count?: number }> | undefined;
  // The step-4 failed batch may also be present; find any done/completed batch.
  const doneBatch = Array.isArray(ps2) ? ps2.find((b) => b.status === 'done' || b.status === 'completed') : undefined;
  if (doneBatch) ok(`batch completed under the wide grant (resources: ${doneBatch.resource_count ?? '?'})`); else fail(`expected a completed batch under the wide grant; pipeline=${JSON.stringify(ps2)}`);

  step('6. lifecycle — rollback / disable / enable');
  if (cli('market rollback whonet-sqlite 1.0.0 --json').code === 0) ok('rolled back to v1.0.0'); else fail('rollback');
  if (cli('market disable whonet-sqlite --json').code === 0) ok('disabled'); else fail('disable');
  if (cli('market enable whonet-sqlite --json').code === 0) ok('enabled'); else fail('enable');

  finish();
}

function finish(): never {
  console.log(failures === 0 ? '\n✅ Marketplace live acceptance PASSED' : `\n❌ Marketplace live acceptance FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
