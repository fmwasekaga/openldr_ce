// Live Postgres acceptance for the FHIR validation strictness gate — proves, against a REAL
// internal Postgres (not pg-mem stubs), that `persistResources(deps, resources, provenance, opts)`
// from @openldr/db runs `validateBatch` and enforces Rule #1 (a laboratory Observation must
// reference a ServiceRequest via `basedOn`) end to end:
//   - at `high`, an order-less lab Observation is REJECTED (throws AppError VA0002) and NOTHING is
//     saved — proving the gate runs before any write, against a real store;
//   - at `high`, a lab Observation whose ServiceRequest resolves IN-BATCH is accepted;
//   - at `high`, a lab Observation whose ServiceRequest resolves IN-STORE (already persisted, not
//     in the current batch) is accepted — this is the only place `resolveServiceRequest` actually
//     hits a real `fhirStore.exists` query, which pg-mem/unit tests cannot exercise faithfully;
//   - at `low`, no clinical rule runs, so the same order-less Observation is accepted.
//
// It mirrors scripts/workflow-secret-smoke.ts / scripts/sync-live-acceptance.ts: provision ONE
// fresh throwaway internal DB on :5433, migrate to latest, run the flow, assert, and drop the
// database in `finally`. Nothing shared is touched.
//
// Preconditions: dev Postgres up on :5433 with the maintenance `openldr` DB.
//   docker compose up -d postgres
// If unreachable, this SKIPS CLEANLY (exit 0) — never fails a box with no Postgres.
//
// Run: pnpm validation:accept       (or: pnpm exec tsx scripts/validation-strictness-live-acceptance.ts)
//
// Env override:
//   ADMIN_DATABASE_URL (postgres://openldr:openldr@localhost:5433/openldr) — maintenance DB used to
//   CREATE/DROP the throwaway test database.
import { type Kysely, sql } from 'kysely';
import { createInternalDb, createMigrator, internalMigrations, createFhirStore, persistResources, type PersistDeps } from '@openldr/db';
import type { StrictnessLevel } from '@openldr/fhir';
import { AppError } from '@openldr/core';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr';
const SMOKE_DB = `openldr_vs_accept_${Date.now()}`;

const urlFor = (dbName: string): string => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
};

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
const SKIP = (why: string) => {
  console.log(`⏭ validation:accept SKIPPED — ${why}`);
  process.exit(0);
};

// Surface real validation-gate failures (they would be findings); stay quiet otherwise.
const logger = {
  info() {},
  warn(o: unknown, m?: string) { console.log('  [validation.warn]', m ?? '', o); },
  debug() {},
  error(o: unknown, m?: string) { console.error('  [validation.error]', m ?? '', o); },
};

async function provisionDb(admin: Kysely<unknown>, dbName: string): Promise<void> {
  await sql.raw(`drop database if exists ${dbName} with (force)`).execute(admin);
  await sql.raw(`create database ${dbName}`).execute(admin);
}

const patient = { resourceType: 'Patient', id: 'vp1' };
const sr = { resourceType: 'ServiceRequest', id: 'vsr1', status: 'active', intent: 'order', subject: { reference: 'Patient/vp1' } };

function labObs(basedOn?: Array<{ reference: string }>) {
  return {
    resourceType: 'Observation',
    id: 'vo1',
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { coding: [{ system: 'http://loinc.org', code: '718-7' }] },
    subject: { reference: 'Patient/vp1' },
    ...(basedOn ? { basedOn } : {}),
  };
}

async function main(): Promise<void> {
  // Admin Postgres reachability probe — no Postgres → clean skip.
  const admin = createInternalDb(ADMIN_URL);
  const adminDb = admin.db as unknown as Kysely<unknown>;
  try {
    await sql`select 1`.execute(adminDb);
  } catch {
    await admin.close().catch(() => {});
    SKIP('needs a reachable Postgres on :5433');
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

    const fhirStore = createFhirStore(db);
    const deps: PersistDeps = { fhirStore, logger: logger as never };
    const opts = (level: StrictnessLevel) => ({
      level,
      resolveServiceRequest: (id: string) => fhirStore.exists('ServiceRequest', id),
    });

    // ── 1. HIGH rejects an order-less lab Observation; nothing is saved ──
    step('1. HIGH: order-less lab Observation is REJECTED, nothing saved');
    let threw: unknown;
    try {
      await persistResources(deps, [patient, labObs()], {}, opts('high'));
    } catch (e) {
      threw = e;
    }
    assert(threw instanceof AppError, 'persistResources threw an AppError');
    const appErr = threw as AppError;
    assert(appErr.code === 'VA0002', `AppError.code === 'VA0002' (got ${appErr.code})`);
    assert(appErr.details != null && typeof appErr.details === 'object' && 'outcome' in (appErr.details as object),
      'AppError.details.outcome is present');
    assert(!(await fhirStore.exists('Observation', 'vo1')), 'Observation/vo1 was NOT saved (atomic reject against a real DB)');

    // ── 2. HIGH passes when the ServiceRequest resolves IN-BATCH ──
    step('2. HIGH: lab Observation with an in-batch ServiceRequest is ACCEPTED');
    await persistResources(deps, [patient, sr, labObs([{ reference: 'ServiceRequest/vsr1' }])], {}, opts('high'));
    assert(await fhirStore.exists('Observation', 'vo1'), 'Observation/vo1 now exists in the store');

    // ── 3. HIGH passes when the ServiceRequest resolves IN-STORE (not in this batch) ──
    step('3. HIGH: lab Observation with an in-STORE (not in-batch) ServiceRequest is ACCEPTED');
    await persistResources(deps, [{ ...labObs([{ reference: 'ServiceRequest/vsr1' }]), id: 'vo2' }], {}, opts('high'));
    assert(await fhirStore.exists('Observation', 'vo2'), 'Observation/vo2 now exists in the store (real fhirStore.exists resolution)');

    // ── 4. LOW runs no clinical rule: order-less lab Observation is ACCEPTED ──
    step('4. LOW: order-less lab Observation is ACCEPTED (no clinical rule runs)');
    await persistResources(deps, [{ ...labObs(), id: 'vo3' }], {}, opts('low'));
    assert(await fhirStore.exists('Observation', 'vo3'), 'Observation/vo3 now exists in the store');
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
    console.log('\n✅ validation:accept PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ validation:accept FAILED');
    process.exit(1);
  }
}

void main();
