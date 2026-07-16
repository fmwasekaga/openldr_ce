// Two-Postgres integration proof for Distributed Sync S6a — the AMENDMENT round-trip (central → lab).
// A lab authors a PRELIMINARY Observation that is mirrored UP to central (S1 push, here simulated via
// applyRemote at origin version 1 + the lab's site_id). CENTRAL then amends that lab-owned resource
// (new version + a Provenance + two sync_amendments outbox rows, all in one transaction). The lab then
// PULLS its amendment stream back DOWN and converges to the amended version — with Provenance, the
// owning site_id preserved, site-scoped, and idempotent.
//
// This is a REAL-Postgres harness (not pg-mem): the amend transaction, fhir.resource_history/change_log
// appends, sync_amendments bigserial `seq`, and the seq-windowed serveAmendments read all exercise real
// PG semantics. It mirrors scripts/sync-pull-live-acceptance.ts (the S2 reference PULL harness) and
// scripts/sync-live-acceptance.ts (the S1 PUSH harness): create fresh DBs on :5433, migrate to latest,
// construct createInternalDb + createFhirStore handles, drive the runner, assert against fhir.* +
// sync_amendments, and drop the DBs in a finally.
//
// DELIBERATE S6a SHORTCUT (flagged): the central pull-amendments endpoint's HTTP/JWKS transport +
// client-credentials auth + site-scoping principal are unit-proven in Tasks 6/7; this harness does NOT
// stand up Fastify/JWKS. Instead the pull runner's `postPull` calls serveAmendments(centralCtx, SITE,
// fromSeq) IN-PROCESS — the SAME serve logic the POST /api/sync/pull-amendments route calls — with a
// minimal ctx stub `{ internalDb: centralDb, logger: console }` (serveAmendments only touches those
// two). This isolates and proves the data round-trip.
//
// Topology (two logical instances, one internal DB each):
//   - openldr_s6a_central : central internal DB (mirrors the lab result; authors the amendment; owns
//                           sync_amendments)
//   - openldr_s6a_lab     : lab internal DB (owns the result; drains the amendment back down)
//
// Each DB is dropped-if-exists then created fresh and migrated to latest, so the run is repeatable; a
// finally block drops both.
//
// Preconditions: dev Postgres up on :5433 with the maintenance `openldr` DB.
//   docker compose up -d postgres
//
// Run: pnpm sync:amend:accept
//
// Env override:
//   ADMIN_DATABASE_URL (postgres://openldr:openldr@localhost:5433/openldr) — maintenance DB used to
//   CREATE/DROP the two test databases.
import { type Kysely, sql } from 'kysely';
import {
  createInternalDb,
  createFhirStore,
  createMigrator,
  internalMigrations,
} from '@openldr/db';
import { serveAmendments } from '@openldr/bootstrap';
import { createAmendmentPullRunner, type PullRequest, type AmendmentPullResponse } from '@openldr/sync';
import type { FhirResource } from '@openldr/fhir';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr';
const urlFor = (dbName: string): string => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
};

const CENTRAL_DB = 'openldr_s6a_central';
const LAB_DB = 'openldr_s6a_lab';
const SITE = 'lab-a';

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
const pass = (m: string) => console.log(`PASS: ${m}`);

const RUN_TAG = `s6a-accept-${Date.now()}`;
const obsId = `${RUN_TAG}-obs`;

async function provisionDb(admin: Kysely<unknown>, dbName: string): Promise<void> {
  // DROP/CREATE DATABASE cannot run inside a transaction; Kysely runs raw sql in autocommit. WITH
  // (FORCE) (pg 13+) evicts any stale session a crashed prior run may have left connected.
  await sql.raw(`drop database if exists ${dbName} with (force)`).execute(admin);
  await sql.raw(`create database ${dbName}`).execute(admin);
}

async function provisionDrop(admin: Kysely<unknown>, dbName: string): Promise<void> {
  await sql.raw(`drop database if exists ${dbName} with (force)`).execute(admin);
}

async function migrateInternal(db: Kysely<unknown>): Promise<void> {
  const r = await createMigrator(db, internalMigrations).migrateToLatest();
  if (r.error) throw r.error;
}

// A preliminary lab Observation (the pre-amendment body). valueQuantity 13.5 g/dL; the central
// amendment corrects it to 14.2 and flips status → 'amended'.
function preliminaryObservation(): FhirResource {
  return {
    resourceType: 'Observation',
    id: obsId,
    status: 'preliminary',
    code: { coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] },
    subject: { reference: 'Patient/s6a-pat' },
    valueQuantity: { value: 13.5, unit: 'g/dL' },
    effectiveDateTime: '2026-05-02T00:00:00Z',
  } as unknown as FhirResource;
}

async function main(): Promise<void> {
  const admin = createInternalDb(ADMIN_URL);
  const adminDb = admin.db as unknown as Kysely<unknown>;

  let failures = 0;
  const assert = (cond: boolean, detail: string) => {
    if (cond) { ok(detail); return; }
    failures++;
    console.error(`FAIL: ${detail}`);
    throw new Error(detail);
  };

  let central: ReturnType<typeof createInternalDb> | undefined;
  let lab: ReturnType<typeof createInternalDb> | undefined;

  try {
    step('0. provision + migrate two fresh databases on :5433');
    await provisionDb(adminDb, CENTRAL_DB);
    await provisionDb(adminDb, LAB_DB);
    ok(`created ${CENTRAL_DB}, ${LAB_DB}`);

    central = createInternalDb(urlFor(CENTRAL_DB));
    lab = createInternalDb(urlFor(LAB_DB));
    const centralDb = central.db;
    const labDb = lab.db;

    await migrateInternal(centralDb as unknown as Kysely<unknown>);
    await migrateInternal(labDb as unknown as Kysely<unknown>);
    ok('migrated central + lab (internal) to latest');

    const centralStore = createFhirStore(centralDb);
    const labStore = createFhirStore(labDb);

    // ── 1. A lab authors a preliminary Observation, mirrored UP to central (simulate the S1 push with
    //    applyRemote at origin version 1 + the lab's site_id). The lab keeps its OWN copy at v1 too so
    //    the amendment has somewhere to land back down. Both change_log rows carry site_id=SITE, which
    //    is what makes central's amend() recognise the resource as lab-owned. ──
    step('1. lab authors preliminary Observation → mirrored up to central (applyRemote v1, siteId=SITE)');
    const seedRecord = {
      resourceType: 'Observation' as const,
      id: obsId,
      version: 1,
      op: 'upsert' as const,
      siteId: SITE,
      resource: preliminaryObservation(),
    };
    const cenApply = await centralStore.applyRemote(seedRecord);
    const labApply = await labStore.applyRemote(seedRecord);
    assert(cenApply === 'applied', `central applied preliminary Observation v1 (got ${cenApply})`);
    assert(labApply === 'applied', `lab applied its own preliminary Observation v1 (got ${labApply})`);
    const seededCentral = await centralStore.get('Observation', obsId);
    assert((seededCentral as { status?: string } | null)?.status === 'preliminary', `central Observation seeded as 'preliminary'`);

    // ── 2. Central amends the lab-owned Observation → version 2, siteId preserved as SITE ──
    step('2. central amends the lab-owned Observation (status=amended, corrected value)');
    const amendResult = await centralStore.amend({
      resourceType: 'Observation',
      id: obsId,
      status: 'amended',
      patch: { valueQuantity: { value: 14.2, unit: 'g/dL' } },
      agent: 'central-reviewer',
      reason: 'QC re-run: hemoglobin corrected 13.5 → 14.2 g/dL',
    });
    ok(`amend → version=${amendResult.version}, provenanceId=${amendResult.provenanceId}, siteId=${amendResult.siteId}`);
    assert(amendResult.version === 2, `amended Observation is version 2 (got ${amendResult.version})`);
    assert(amendResult.siteId === SITE, `amendment routed to the owning lab '${SITE}' (got '${amendResult.siteId}')`);
    // Central wrote two sync_amendments outbox rows (the Observation v2 + its Provenance v1).
    const outbox = await centralDb.selectFrom('sync_amendments').selectAll().where('site_id', '=', SITE).execute();
    assert(outbox.length === 2, `central sync_amendments outbox has 2 rows for '${SITE}' (got ${outbox.length})`);

    // ── 3. In-process amendment drain: a lab-side pull runner whose postPull calls serveAmendments
    //    DIRECTLY (no HTTP — the flagged S6a shortcut). Cursor kept in a local variable. applyRecord =
    //    the lab's applyRemote. serveAmendments only touches ctx.internalDb + ctx.logger, so a minimal
    //    stub suffices. ──
    step('3. lab drains its amendment stream in-process (serveAmendments → applyRemote)');
    const centralCtx = { internalDb: centralDb, logger: console } as never;
    let amendCursor = 0;
    const runner = createAmendmentPullRunner({
      getToken: async () => 'dummy-token', // no HTTP/JWKS in this harness (flagged shortcut)
      postPull: (req: PullRequest): Promise<AmendmentPullResponse> =>
        serveAmendments(centralCtx, SITE, typeof req.fromSeq === 'number' ? req.fromSeq : 0),
      applyRecord: (rec) => labStore.applyRemote(rec),
      readCursor: async () => amendCursor,
      advanceCursor: async (seq) => { amendCursor = seq; },
      logger: {
        info() {},
        warn(o: unknown, m?: string) { console.log('  [sync.warn]', m ?? '', o); },
        debug() {},
        error(o: unknown, m?: string) { console.error('  [sync.error]', m ?? '', o); },
      } as never,
    });

    const cycle1 = await runner.runCycle();
    ok(`drain cycle #1 applied ${cycle1.applied} record(s), outcome '${cycle1.outcome}'; cursor now ${amendCursor}`);
    assert(cycle1.applied === 2, `lab applied 2 amendment records (Observation v2 + Provenance) (got ${cycle1.applied})`);
    assert(cycle1.outcome === 'progressed', `drain cycle #1 reports outcome 'progressed' (got '${cycle1.outcome}')`);

    // ── 4. Assertions at the lab: converged to the amended version, Provenance landed, site preserved ──
    step('4. assert lab converged: amended v2 + patched value + Provenance + owning site preserved');
    const labObs = (await labStore.get('Observation', obsId)) as Record<string, unknown> | null;
    assert(!!labObs, `lab has Observation ${obsId} after drain`);
    assert(labObs?.status === 'amended', `lab Observation status is 'amended' (got '${labObs?.status}')`);
    assert(
      (labObs?.valueQuantity as { value?: number } | undefined)?.value === 14.2,
      `lab Observation carries the patched value 14.2 (got ${(labObs?.valueQuantity as { value?: number } | undefined)?.value})`,
    );
    assert(
      (labObs?.meta as { versionId?: string } | undefined)?.versionId === '2',
      `lab Observation meta.versionId is '2' (got '${(labObs?.meta as { versionId?: string } | undefined)?.versionId}')`,
    );
    const labObsRow = await labDb
      .selectFrom('fhir.fhir_resources')
      .select('version')
      .where('resource_type', '=', 'Observation')
      .where('id', '=', obsId)
      .executeTakeFirst();
    assert(Number(labObsRow?.version) === 2, `lab fhir_resources Observation is at version 2 (got ${labObsRow?.version})`);

    const labProv = await labStore.get('Provenance', amendResult.provenanceId);
    assert(!!labProv, `lab has Provenance ${amendResult.provenanceId}`);
    const provTarget = (labProv as { target?: { reference?: string }[] } | null)?.target?.[0]?.reference;
    assert(provTarget === `Observation/${obsId}`, `lab Provenance targets Observation/${obsId} (got '${provTarget}')`);

    // The lab's change_log row for the amended version keeps the OWNING site_id (not re-stamped local).
    const labClRow = await labDb
      .selectFrom('fhir.change_log')
      .select('site_id')
      .where('resource_type', '=', 'Observation')
      .where('resource_id', '=', obsId)
      .where('version', '=', 2)
      .executeTakeFirst();
    assert(labClRow?.site_id === SITE, `lab change_log v2 row keeps owning site_id='${SITE}' (got '${labClRow?.site_id}')`);
    pass('lab converged to amended v2 with Provenance, owning site preserved');

    // ── 5. Cross-site isolation: a different site's amendment stream is empty ──
    step('5. assert cross-site isolation: a foreign site drains 0 amendment records');
    const foreign = await serveAmendments(centralCtx, 'some-other-site', 0);
    assert(foreign.records.length === 0, `serveAmendments for 'some-other-site' returns 0 records (got ${foreign.records.length})`);
    pass('cross-site: foreign site sees nothing');

    // ── 6. Idempotent re-drain: a second cycle applies 0 and does not move the cursor ──
    step('6. assert idempotent re-drain: second cycle applies 0, cursor unchanged');
    const cursorBefore = amendCursor;
    const cycle2 = await runner.runCycle();
    assert(cycle2.applied === 0, `second drain cycle applied 0 records (got ${cycle2.applied})`);
    assert(cycle2.outcome === 'drained', `second drain cycle reports outcome 'drained' (got '${cycle2.outcome}')`);
    assert(amendCursor === cursorBefore, `cursor unchanged after idempotent re-drain (${amendCursor} === ${cursorBefore})`);
    pass('idempotent: no re-apply, no cursor drift');
  } catch (e) {
    if (failures === 0) failures++;
    console.error('\n[FAIL]', e instanceof Error ? e.stack : e);
  } finally {
    // Close instance handles BEFORE dropping (DROP DATABASE needs no live sessions; WITH FORCE backstops).
    try { await central?.close(); } catch { /* ignore */ }
    try { await lab?.close(); } catch { /* ignore */ }
    try {
      await provisionDrop(adminDb, CENTRAL_DB);
      await provisionDrop(adminDb, LAB_DB);
    } catch (e) { console.error('  [cleanup] drop failed', e); }
    await admin.close();
  }

  if (failures === 0) {
    console.log('\n✅ sync:amend:accept PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ sync:amend:accept FAILED');
    process.exit(1);
  }
}

void main();
