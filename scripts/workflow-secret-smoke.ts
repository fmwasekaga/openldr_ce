// Live smoke for the Workflow Secret Store (SEC-06) — proves, against a REAL internal Postgres, that
// workflow-definition secrets (webhook trigger `secret` + HTTP node `config.headers` blob) are sealed
// into the encrypted `workflow_secrets` store on save, resolvable at use, tamper-proof under the wrong
// key, and boot-migratable from existing plaintext (idempotently).
//
// This exercises the SAME stores + helpers the production boot path wires:
//   createInternalDb + createWorkflowSecretStore + createWorkflowStore  (the real handles)
//   sealDefinitionSecrets  (the ONE seal impl shared by save-time extraction AND boot migration)
//   migrateWorkflowSecrets (the boot-time plaintext→ref shim)
// It mirrors scripts/sync-live-acceptance.ts: provision ONE fresh throwaway database on :5433, migrate
// internal to latest, run the flow, assert, and drop the database in `finally`. Nothing shared is
// touched — the whole `openldr_wfsecret_smoke` DB is created fresh and dropped.
//
// PRECONDITIONS (both required, else it SKIPS CLEANLY with exit 0):
//   1. dev Postgres up on :5433 with the maintenance `openldr` DB   (docker compose up -d postgres)
//   2. SECRETS_ENCRYPTION_KEY set to a base64 32-byte AES-256 key    (export SECRETS_ENCRYPTION_KEY=...)
// A missing key or an unreachable DB prints an `⏭ ... SKIPPED` line and exits 0 (CI/dev boxes without
// either must never fail this script), so a real green run only happens when both are present.
//
// Run: pnpm workflow:secret:accept       (or: pnpm exec tsx scripts/workflow-secret-smoke.ts)
//
// Env override:
//   ADMIN_DATABASE_URL (postgres://openldr:openldr@localhost:5433/openldr) — maintenance DB used to
//   CREATE/DROP the throwaway test database.
import { randomBytes } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { createInternalDb, createMigrator, internalMigrations, createWorkflowSecretStore } from '@openldr/db';
import { createWorkflowStore } from '@openldr/workflows';
import { sealDefinitionSecrets, migrateWorkflowSecrets } from '@openldr/bootstrap';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr';
const KEY = process.env.SECRETS_ENCRYPTION_KEY;
const SMOKE_DB = 'openldr_wfsecret_smoke';

const urlFor = (dbName: string): string => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
};

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
const SKIP = (why: string) => {
  console.log(`⏭ workflow:secret:accept SKIPPED — ${why}`);
  process.exit(0);
};

// Silent logger; surface warns (best-effort migration skips would log here — worth seeing).
const logger = {
  info() {},
  warn(o: unknown, m?: string) { console.log('  [wf.warn]', m ?? '', o); },
  debug() {},
  error(o: unknown, m?: string) { console.error('  [wf.error]', m ?? '', o); },
} as never;

const RUN = `wfsec-smoke-${Date.now()}`;
const WF_SEAL = `${RUN}-sealed`;   // sealed on "save" via sealDefinitionSecrets
const WF_PLAIN = `${RUN}-plain`;   // seeded plaintext, then boot-migrated

const PLAINTEXT_SECRET = 'top-secret-1';
const HEADERS_JSON = '{"Authorization":"Bearer abc123","Content-Type":"application/json"}';
const BEARER = 'Bearer abc123';

/** A webhook-trigger node (data.secret) + an HTTP node (data.config.headers auth blob). */
function definitionWithPlaintext() {
  return {
    nodes: [
      { id: 'hook', type: 'webhook', position: { x: 0, y: 0 }, data: { secret: PLAINTEXT_SECRET } },
      { id: 'http', type: 'http', position: { x: 200, y: 0 }, data: { config: { url: 'https://example.test/hook', headers: HEADERS_JSON } } },
      { id: 'log', type: 'log', position: { x: 400, y: 0 }, data: { level: 'info' } },
    ],
    edges: [
      { id: 'e1', source: 'hook', target: 'http' },
      { id: 'e2', source: 'http', target: 'log' },
    ],
  };
}

function refOf(def: unknown, nodeId: string, pick: (data: Record<string, unknown>) => unknown): string {
  const nodes = (def as { nodes: Array<{ id: string; data: Record<string, unknown> }> }).nodes;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`node ${nodeId} missing from persisted definition`);
  const v = pick(node.data);
  if (!v || typeof v !== 'object' || typeof (v as { secretRef?: unknown }).secretRef !== 'string') {
    throw new Error(`field on ${nodeId} is not a { secretRef } (got ${JSON.stringify(v)})`);
  }
  return (v as { secretRef: string }).secretRef;
}
const isRef = (v: unknown): boolean =>
  !!v && typeof v === 'object' && typeof (v as { secretRef?: unknown }).secretRef === 'string';

async function provisionDb(admin: Kysely<unknown>, dbName: string): Promise<void> {
  await sql.raw(`drop database if exists ${dbName} with (force)`).execute(admin);
  await sql.raw(`create database ${dbName}`).execute(admin);
}

async function main(): Promise<void> {
  if (!KEY) SKIP('needs Postgres + SECRETS_ENCRYPTION_KEY');

  // Probe the maintenance DB; an unreachable Postgres is a clean skip (not a failure).
  const admin = createInternalDb(ADMIN_URL);
  const adminDb = admin.db as unknown as Kysely<unknown>;
  try {
    await sql`select 1`.execute(adminDb);
  } catch {
    await admin.close().catch(() => {});
    SKIP('needs Postgres + SECRETS_ENCRYPTION_KEY');
  }

  let failures = 0;
  const assert = (cond: boolean, detail: string) => {
    if (cond) { ok(detail); return; }
    failures++;
    throw new Error(detail);
  };

  let handle: ReturnType<typeof createInternalDb> | undefined;
  try {
    step('0. provision + migrate a fresh throwaway internal DB on :5433');
    await provisionDb(adminDb, SMOKE_DB);
    handle = createInternalDb(urlFor(SMOKE_DB));
    const db = handle.db;
    const mig = await createMigrator(db as unknown as Kysely<unknown>, internalMigrations).migrateToLatest();
    if (mig.error) throw mig.error;
    ok(`created + migrated ${SMOKE_DB}`);

    const secretStore = createWorkflowSecretStore(db);
    const workflowStore = createWorkflowStore(db);

    const rowsFor = (workflowId: string) =>
      db.selectFrom('workflow_secrets').select(['id', 'sealed_value']).where('workflow_id', '=', workflowId).execute();
    const totalSecretRows = async (): Promise<number> => {
      const r = await db.selectFrom('workflow_secrets').select((eb) => eb.fn.countAll().as('n')).executeTakeFirst();
      return r?.n != null ? Number(r.n) : -1;
    };

    // ── 1. Seal on "save": sealDefinitionSecrets → persist the ref-only definition ──
    step('1. seal a definition on save → persisted has ONLY { secretRef }, no cleartext at rest');
    const sealedDef = await sealDefinitionSecrets(definitionWithPlaintext(), WF_SEAL, secretStore, KEY);
    await workflowStore.create({
      id: WF_SEAL, name: 'wf-sealed-smoke', description: null, enabled: true, createdBy: null,
      definition: sealedDef as never,
    } as never);
    const persisted = (await workflowStore.get(WF_SEAL))!.definition;
    const persistedJson = JSON.stringify(persisted);
    const hookRef = refOf(persisted, 'hook', (d) => d.secret);
    const headersRef = refOf(persisted, 'http', (d) => (d.config as { headers: unknown }).headers);
    assert(isRef((persisted as { nodes: Array<{ id: string; data: Record<string, unknown> }> }).nodes.find((n) => n.id === 'hook')!.data.secret),
      'persisted webhook secret is a { secretRef }');
    assert(!persistedJson.includes(PLAINTEXT_SECRET), `persisted definition contains NO cleartext '${PLAINTEXT_SECRET}'`);
    assert(!persistedJson.includes(BEARER), `persisted definition contains NO cleartext '${BEARER}'`);
    const sealRows = await rowsFor(WF_SEAL);
    assert(sealRows.length === 2, `workflow_secrets has 2 sealed rows for ${WF_SEAL} (got ${sealRows.length})`);
    assert(sealRows.every((r) => !r.sealed_value.includes(PLAINTEXT_SECRET) && !r.sealed_value.includes(BEARER)),
      'every sealed_value is ciphertext (no plaintext / no Bearer token)');

    // ── 2. Resolve returns the originals ──
    step('2. resolve(ref, key) returns the original plaintext values');
    assert((await secretStore.resolve(hookRef, KEY)) === PLAINTEXT_SECRET, `resolve(hookRef) === '${PLAINTEXT_SECRET}'`);
    const resolvedHeaders = await secretStore.resolve(headersRef, KEY);
    assert(resolvedHeaders.includes(BEARER), `resolve(headersRef) returns the headers JSON incl. '${BEARER}'`);
    assert(JSON.stringify(JSON.parse(resolvedHeaders)) === JSON.stringify(JSON.parse(HEADERS_JSON)),
      'resolved headers blob re-parses to the original object');

    // ── 3. Wrong key → resolve throws (GCM auth-tag mismatch) ──
    step('3. resolve with the WRONG key throws (tamper/auth failure)');
    const wrongKey = randomBytes(32).toString('base64');
    let threw = false;
    try { await secretStore.resolve(hookRef, wrongKey); } catch { threw = true; }
    assert(threw, 'resolve(hookRef, wrongKey) threw');

    // ── 4. Boot migration of an existing PLAINTEXT workflow (bypass sealing on seed) ──
    step('4. boot migration: seed plaintext directly → migrateWorkflowSecrets seals it → idempotent');
    await workflowStore.create({
      id: WF_PLAIN, name: 'wf-plain-smoke', description: null, enabled: true, createdBy: null,
      definition: definitionWithPlaintext() as never,
    } as never);
    // Confirm the seed really is plaintext at rest (bypassed sealing).
    const seededJson = JSON.stringify((await workflowStore.get(WF_PLAIN))!.definition);
    assert(seededJson.includes(PLAINTEXT_SECRET) && seededJson.includes(BEARER), `seed ${WF_PLAIN} is plaintext at rest`);

    await migrateWorkflowSecrets({ store: workflowStore, secretStore, key: KEY, logger });

    const migrated = (await workflowStore.get(WF_PLAIN))!.definition;
    const migratedJson = JSON.stringify(migrated);
    const mHookRef = refOf(migrated, 'hook', (d) => d.secret);
    refOf(migrated, 'http', (d) => (d.config as { headers: unknown }).headers); // asserts it became a ref
    assert(!migratedJson.includes(PLAINTEXT_SECRET) && !migratedJson.includes(BEARER),
      `migrated ${WF_PLAIN} definition has NO cleartext`);
    assert((await rowsFor(WF_PLAIN)).length === 2, `workflow_secrets has 2 sealed rows for ${WF_PLAIN}`);
    assert((await secretStore.resolve(mHookRef, KEY)) === PLAINTEXT_SECRET, 'migrated webhook secret resolves to the plaintext');

    // Idempotent second pass: no new rows, definition unchanged (still all refs).
    const rowsBefore = await totalSecretRows();
    await migrateWorkflowSecrets({ store: workflowStore, secretStore, key: KEY, logger });
    const rowsAfter = await totalSecretRows();
    assert(rowsAfter === rowsBefore, `second migrate minted NO new secret rows (${rowsAfter} === ${rowsBefore})`);
    assert(JSON.stringify((await workflowStore.get(WF_PLAIN))!.definition) === migratedJson,
      'second migrate left the (all-refs) definition unchanged');

    // ── 5. Cleanup the smoke workflows + their secrets (belt-and-braces; the DB is dropped anyway) ──
    step('5. cleanup smoke workflows + their secrets');
    for (const id of [WF_SEAL, WF_PLAIN]) {
      await secretStore.deleteForWorkflow(id);
      await workflowStore.remove(id);
    }
    assert((await totalSecretRows()) === 0, 'all smoke secret rows deleted');
    ok('smoke workflows + secrets removed');
  } catch (e) {
    if (failures === 0) failures++;
    console.error('\nFAIL:', e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) console.error(e.stack);
  } finally {
    try { await handle?.close(); } catch { /* ignore */ }
    try { await sql.raw(`drop database if exists ${SMOKE_DB} with (force)`).execute(adminDb); } catch (e) { console.error('  [cleanup] drop failed', e); }
    await admin.close().catch(() => {});
  }

  if (failures === 0) {
    console.log('\n✅ workflow:secret:accept PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ workflow:secret:accept FAILED');
    process.exit(1);
  }
}

void main();
