// Two-Postgres integration proof for Distributed Sync S1 — the DATA round-trip (restructure sync S1
// Task 8). A lab instance's operational FHIR (fhir.change_log stamped with the lab's site_id) is
// replicated up to a central instance via the push runner, mirror-applied at the ORIGIN version +
// ORIGIN site_id, idempotently, with cross-site records rejected.
//
// This is a REAL-Postgres harness (not pg-mem): the push runner tails fhir.change_log through the
// same MVCC safe-frontier (`fetchSafeChangeRows`) the projection worker uses, and that watermark SQL
// (system `xmin` vs `pg_snapshot_xmin(pg_current_snapshot())`) cannot run under pg-mem. It mirrors
// scripts/projection-live-acceptance.ts: create databases on :5433, migrate to latest, construct
// createInternalDb + createFhirStore handles, seed FHIR via save(), drive the runner to completion,
// and assert against fhir.* + the canonical read model.
//
// DELIBERATE S1 SHORTCUT (flagged): the central endpoint's HTTP/JWKS transport + client-credentials
// auth are unit-proven in Task 5; this harness does NOT stand up Fastify/JWKS. Instead `postPush` is
// an IN-PROCESS function that runs the SAME per-record apply + cross-site logic as
// apps/server/src/sync-routes.ts (kept faithful to it — see inProcessPush below), using a stub site
// principal `{ siteId: 'site-lab-1' }`. This isolates and proves the data round-trip.
//
// Topology (mirrors projection-acceptance's internal+external split, per logical instance):
//   - openldr_sync_lab            : lab internal DB (fhir.* + change_log, site-stamped)
//   - openldr_sync_central        : central internal DB (fhir.* mirror target)
//   - openldr_sync_central_target : central external DB (canonical read model for assertion c)
// The lab needs no read model (it only saves + pushes). Central needs a separate external target
// because internal + external migrations share the default kysely_migration tracking table and so
// cannot co-locate in one database.
//
// Each DB is dropped-if-exists then created fresh and migrated to latest, so the run is repeatable;
// a finally block drops all three.
//
// Preconditions: dev Postgres up on :5433 with the maintenance `openldr` DB.
//   docker compose up -d postgres
//
// Run: pnpm sync:accept
//
// Env override:
//   ADMIN_DATABASE_URL (postgres://openldr:openldr@localhost:5433/openldr) — maintenance DB used to
//   CREATE/DROP the three test databases.
import { type Kysely, sql } from 'kysely';
import {
  createInternalDb,
  createFhirStore,
  createRelationalWriter,
  createMigrator,
  internalMigrations,
  externalMigrations,
  reprojectAll,
  fetchSafeChangeRows,
  readCursor,
  advanceCursor,
  type ExternalSchema,
} from '@openldr/db';
import { createSyncPushRunner, type PushBatch, type PushResponse, type SyncRecord } from '@openldr/sync';
import type { FhirResource } from '@openldr/fhir';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr';
const urlFor = (dbName: string): string => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
};

const LAB_DB = 'openldr_sync_lab';
const CENTRAL_DB = 'openldr_sync_central';
const CENTRAL_TARGET_DB = 'openldr_sync_central_target';
const LAB_SITE = 'site-lab-1';

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
const pass = (m: string) => console.log(`PASS: ${m}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Surface real apply failures (they would be findings); stay quiet otherwise.
const logger = {
  info() {},
  warn(o: unknown, m?: string) { console.log('  [sync.warn]', m ?? '', o); },
  debug() {},
  error(o: unknown, m?: string) { console.error('  [sync.error]', m ?? '', o); },
};

const RUN_TAG = `sync-accept-${Date.now()}`;
const patId = `${RUN_TAG}-pat`;
const spId = `${RUN_TAG}-sp`;
const srId = `${RUN_TAG}-sr`;
const obsId = `${RUN_TAG}-obs`;
const drId = `${RUN_TAG}-dr`;
const SEED_IDS = [patId, spId, srId, obsId, drId];

// Referentially-consistent seed graph (matches the reference style of the existing projection/reports
// fixtures so central's canonical projection populates every FK-linked table).
function seedResources(): FhirResource[] {
  return [
    { resourceType: 'Patient', id: patId, identifier: [{ system: 'urn:patient', value: 'PID-SYNC-1' }], name: [{ family: 'Sync', given: ['Ada'] }], gender: 'female', birthDate: '1985-04-12' },
    { resourceType: 'Specimen', id: spId, type: { coding: [{ code: 'blood' }], text: 'Blood' }, subject: { reference: `Patient/${patId}` }, receivedTime: '2026-05-01T08:00:00Z' },
    { resourceType: 'ServiceRequest', id: srId, status: 'active', intent: 'order', subject: { reference: `Patient/${patId}` }, code: { coding: [{ system: 'http://loinc.org', code: '58410-2', display: 'CBC panel' }] }, authoredOn: '2026-05-01T09:00:00Z' },
    { resourceType: 'Observation', id: obsId, status: 'final', basedOn: [{ reference: `ServiceRequest/${srId}` }], subject: { reference: `Patient/${patId}` }, specimen: { reference: `Specimen/${spId}` }, code: { coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] }, valueQuantity: { value: 13.5, unit: 'g/dL' }, effectiveDateTime: '2026-05-02T00:00:00Z' },
    { resourceType: 'DiagnosticReport', id: drId, status: 'final', subject: { reference: `Patient/${patId}` }, code: { coding: [{ system: 'http://loinc.org', code: '58410-2', display: 'CBC panel' }] }, result: [{ reference: `Observation/${obsId}` }], issued: '2026-05-02T10:00:00Z' },
  ] as unknown as FhirResource[];
}

async function provisionDb(admin: Kysely<unknown>, dbName: string): Promise<void> {
  // DROP/CREATE DATABASE cannot run inside a transaction; Kysely runs raw sql in autocommit. WITH
  // (FORCE) (pg 13+) evicts any stale session a crashed prior run may have left connected.
  await sql.raw(`drop database if exists ${dbName} with (force)`).execute(admin);
  await sql.raw(`create database ${dbName}`).execute(admin);
}

async function migrateInternal(db: Kysely<unknown>): Promise<void> {
  const r = await createMigrator(db, internalMigrations).migrateToLatest();
  if (r.error) throw r.error;
}

async function migrateExternal(db: Kysely<unknown>): Promise<void> {
  const r = await createMigrator(db, externalMigrations('postgres')).migrateToLatest();
  if (r.error) throw r.error;
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

  // Handles are created after provisioning; keep refs so finally can close before dropping.
  let lab: ReturnType<typeof createInternalDb> | undefined;
  let central: ReturnType<typeof createInternalDb> | undefined;
  let centralTarget: ReturnType<typeof createInternalDb> | undefined;

  try {
    step('0. provision + migrate three fresh databases on :5433');
    await provisionDb(adminDb, LAB_DB);
    await provisionDb(adminDb, CENTRAL_DB);
    await provisionDb(adminDb, CENTRAL_TARGET_DB);
    ok(`created ${LAB_DB}, ${CENTRAL_DB}, ${CENTRAL_TARGET_DB}`);

    lab = createInternalDb(urlFor(LAB_DB));
    central = createInternalDb(urlFor(CENTRAL_DB));
    centralTarget = createInternalDb(urlFor(CENTRAL_TARGET_DB));
    const labDb = lab.db;
    const centralDb = central.db;
    const centralTargetDb = centralTarget.db as unknown as Kysely<ExternalSchema>;

    await migrateInternal(labDb as unknown as Kysely<unknown>);
    await migrateInternal(centralDb as unknown as Kysely<unknown>);
    await migrateExternal(centralTargetDb as unknown as Kysely<unknown>);
    ok('migrated lab (internal) + central (internal) + central-target (external) to latest');

    // Stamp the lab's site BEFORE the fhir store resolves it (resolveSiteId memoizes on first save).
    await labDb
      .insertInto('app_settings')
      .values({ key: 'sync.site_id', value: LAB_SITE })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: LAB_SITE }))
      .execute();
    ok(`lab app_settings 'sync.site_id' = '${LAB_SITE}'`);

    const labStore = createFhirStore(labDb);
    const centralStore = createFhirStore(centralDb);

    // ── In-process central endpoint (the flagged S1 shortcut). Faithful to sync-routes.ts:
    //    cross-site → reject (not applied); applyRemote → applied/skipped tally; throw → apply-error
    //    reject; ackSeq = max handled seq (seeded from fromSeq so it never moves backward). ──
    async function inProcessPush(batch: PushBatch, principal: { siteId: string }): Promise<PushResponse> {
      const records = Array.isArray(batch.records) ? batch.records : [];
      const fromSeq = Number.isFinite(batch.fromSeq) ? batch.fromSeq : 0;
      let applied = 0;
      let skipped = 0;
      let ackSeq = fromSeq;
      const rejects: PushResponse['rejects'] = [];
      const seqOf = (r: unknown): number =>
        r != null && typeof r === 'object' && Number.isFinite((r as { seq?: unknown }).seq)
          ? (r as { seq: number }).seq
          : 0;
      const ordered = [...records].sort((a, b) => seqOf(a) - seqOf(b));
      for (const record of ordered) {
        const rawSeq = record != null && typeof record === 'object' ? (record as { seq?: unknown }).seq : undefined;
        if (typeof rawSeq === 'number' && Number.isFinite(rawSeq)) ackSeq = Math.max(ackSeq, rawSeq);
        const r = record as Partial<SyncRecord & { seq: number }> | null | undefined;
        if (
          r == null || typeof r !== 'object' ||
          typeof r.id !== 'string' || typeof r.siteId !== 'string' ||
          (r.op !== 'upsert' && r.op !== 'delete') ||
          typeof r.seq !== 'number' || !Number.isFinite(r.seq)
        ) {
          rejects.push({ id: typeof r?.id === 'string' ? r.id : '', version: typeof r?.version === 'number' ? r.version : 0, seq: typeof r?.seq === 'number' ? r.seq : 0, reason: 'malformed' });
          continue;
        }
        const rec = r as SyncRecord & { seq: number };
        if (rec.siteId !== principal.siteId) {
          rejects.push({ id: rec.id, version: rec.version, seq: rec.seq, reason: 'cross-site' });
          continue;
        }
        try {
          const result = await centralStore.applyRemote(rec);
          if (result === 'applied') applied++; else skipped++;
        } catch (e) {
          logger.warn({ error: e instanceof Error ? e.message : String(e), id: rec.id, seq: rec.seq }, 'inProcessPush: applyRemote failed');
          rejects.push({ id: rec.id, version: rec.version, seq: rec.seq, reason: 'apply-error' });
        }
      }
      return { ackSeq, applied, skipped, rejects };
    }

    const runner = createSyncPushRunner({
      internalDb: labDb,
      fetchSafeRows: fetchSafeChangeRows,
      // Upsert body for a specific origin version, read from the lab's append-only history (mirrors the
      // bootstrap host wiring in packages/bootstrap/src/index.ts).
      fetchContent: async (resourceType, id, version) => {
        const row = await labDb
          .selectFrom('fhir.resource_history')
          .select('resource')
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .where('version', '=', version)
          .executeTakeFirst();
        return row?.resource ?? null;
      },
      postPush: (batch) => inProcessPush(batch, { siteId: LAB_SITE }),
      getToken: async () => 'dummy-token', // no HTTP/JWKS in this harness (flagged shortcut)
      readCursor: () => readCursor(labDb, 'sync-push'),
      advanceCursor: (seq) => advanceCursor(labDb, 'sync-push', seq),
      logger,
      batchSize: 500,
    });

    const labCursor = () => readCursor(labDb, 'sync-push');
    const labMaxSeq = async (): Promise<number> => {
      const r = await labDb.selectFrom('fhir.change_log').select((eb) => eb.fn.max('seq').as('m')).executeTakeFirst();
      return r?.m != null ? Number(r.m) : 0;
    };
    const centralResourceCount = async (): Promise<number> => {
      const r = await centralDb.selectFrom('fhir.fhir_resources').select((eb) => eb.fn.countAll().as('n')).executeTakeFirst();
      return r?.n != null ? Number(r.n) : 0;
    };

    // Drain: run cycles until the lab cursor stops advancing AND nothing is applied (max-iter capped so
    // a bug cannot infinite-loop). Returns total applied + cycle count.
    async function drain(maxIters = 200): Promise<{ cycles: number; applied: number }> {
      let applied = 0;
      let cycles = 0;
      for (let i = 0; i < maxIters; i++) {
        const before = await labCursor();
        const a = await runner.runCycle();
        const after = await labCursor();
        applied += a;
        cycles++;
        if (a === 0 && after === before) break;
        await sleep(20);
      }
      return { cycles, applied };
    }

    // ── Seed the lab ──
    step(`1. seed lab with 5 referentially-consistent resources (site ${LAB_SITE})`);
    for (const res of seedResources()) await labStore.save(res);
    const labSeqTarget = await labMaxSeq();
    ok(`saved Patient/Specimen/ServiceRequest/Observation/DiagnosticReport; lab max(seq)=${labSeqTarget}`);
    // Confirm the change_log carries the lab site stamp (precondition for cross-site to work at all).
    const stampRows = await labDb.selectFrom('fhir.change_log').select(['resource_id', 'site_id']).where('resource_id', 'in', SEED_IDS).execute();
    assert(stampRows.length === 5, `lab change_log has 5 rows for the seed (got ${stampRows.length})`);
    assert(stampRows.every((r) => r.site_id === LAB_SITE), `every lab change_log seed row is stamped site_id='${LAB_SITE}'`);

    // ── Push drain #1 ──
    step('2. push drain #1: replicate lab → central');
    const d1 = await drain();
    ok(`drain #1: ${d1.cycles} cycle(s), ${d1.applied} record(s) applied by central`);
    assert(d1.applied === 5, `central durably applied all 5 records (got ${d1.applied})`);
    assert((await labCursor()) >= labSeqTarget, `lab 'sync-push' cursor reached max seq (${await labCursor()} >= ${labSeqTarget})`);

    // ── Assertion (a): central fhir_resources has all 5 at the SAME versions the lab has ──
    step('3. assert (a) central mirrors all 5 resources at origin versions');
    for (const res of seedResources()) {
      const rt = res.resourceType;
      const id = (res as { id: string }).id;
      const labV = await labDb.selectFrom('fhir.fhir_resources').select('version').where('resource_type', '=', rt).where('id', '=', id).executeTakeFirst();
      const cenV = await centralDb.selectFrom('fhir.fhir_resources').select('version').where('resource_type', '=', rt).where('id', '=', id).executeTakeFirst();
      assert(!!cenV, `central fhir_resources has ${rt}/${id}`);
      assert(!!labV && Number(cenV!.version) === Number(labV.version), `${rt}/${id} central version ${cenV?.version} == lab version ${labV?.version}`);
    }
    pass('(a) all 5 mirrored at origin versions');

    // ── Assertion (b): central change_log preserves the ORIGIN site_id (not re-stamped to local) ──
    step('4. assert (b) central change_log preserves origin site_id');
    const cenStamp = await centralDb.selectFrom('fhir.change_log').select(['resource_id', 'site_id']).where('resource_id', 'in', SEED_IDS).execute();
    assert(cenStamp.length === 5, `central change_log has 5 rows for the seed (got ${cenStamp.length})`);
    assert(cenStamp.every((r) => r.site_id === LAB_SITE), `every central change_log seed row carries origin site_id='${LAB_SITE}' (NOT re-stamped)`);
    pass('(b) origin site_id preserved on central');

    // ── Assertion (c): central projection populates the canonical read model ──
    step('5. assert (c) central projection → canonical read model (all 5 tables)');
    const relationalWriter = createRelationalWriter(centralTargetDb, 'postgres');
    const rebuilt = await reprojectAll({ internalDb: centralDb, relationalWriter });
    ok(`central reprojectAll rebuilt ${rebuilt} canonical resource(s)`);
    const rowExists = async (table: keyof ExternalSchema, id: string): Promise<boolean> =>
      !!(await centralTargetDb.selectFrom(table).select('id' as never).where('id' as never, '=', id as never).executeTakeFirst());
    assert(await rowExists('patients', patId), `patients has ${patId}`);
    assert(await rowExists('lab_requests', srId), `lab_requests has ServiceRequest ${srId}`);
    assert(await rowExists('lab_results', obsId), `lab_results has Observation ${obsId}`);
    assert(await rowExists('specimens', spId), `specimens has Specimen ${spId}`);
    assert(await rowExists('diagnostic_reports', drId), `diagnostic_reports has DiagnosticReport ${drId}`);
    pass('(c) canonical read model populated for all 5 resources');

    // ── Assertion (d): idempotency — second drain applies 0, counts + cursor unchanged ──
    step('6. assert (d) idempotency: second push drain is a no-op');
    const cursorBefore = await labCursor();
    const countBefore = await centralResourceCount();
    const cenChangeLogBefore = (await centralDb.selectFrom('fhir.change_log').select((eb) => eb.fn.countAll().as('n')).executeTakeFirst());
    const clBefore = cenChangeLogBefore?.n != null ? Number(cenChangeLogBefore.n) : -1;
    const d2 = await drain();
    ok(`drain #2: ${d2.cycles} cycle(s), ${d2.applied} applied`);
    assert(d2.applied === 0, `second drain applied 0 records (all idempotent skips) (got ${d2.applied})`);
    assert((await labCursor()) === cursorBefore, `lab cursor unchanged after re-drain (${await labCursor()} === ${cursorBefore})`);
    assert((await centralResourceCount()) === countBefore, `central fhir_resources count unchanged (${await centralResourceCount()} === ${countBefore})`);
    const clAfterRow = (await centralDb.selectFrom('fhir.change_log').select((eb) => eb.fn.countAll().as('n')).executeTakeFirst());
    const clAfter = clAfterRow?.n != null ? Number(clAfterRow.n) : -2;
    assert(clAfter === clBefore, `central change_log count unchanged (${clAfter} === ${clBefore})`);
    pass('(d) idempotent: no re-apply, no cursor/count drift');

    // ── Assertion (e): cross-site rejection ──
    step('7. assert (e) cross-site record is rejected and NOT applied');
    const evilId = `${RUN_TAG}-evil`;
    const crossSiteRecord: SyncRecord & { seq: number } = {
      resourceType: 'Patient', id: evilId, version: 1, op: 'upsert', siteId: 'site-other', seq: labSeqTarget + 1000,
      resource: { resourceType: 'Patient', id: evilId, name: [{ family: 'Intruder' }] } as unknown as FhirResource,
    };
    const evilBatch: PushBatch = { fromSeq: labSeqTarget, records: [crossSiteRecord] };
    const evilResp = await inProcessPush(evilBatch, { siteId: LAB_SITE });
    const rejected = evilResp.rejects.find((rj) => rj.id === evilId && rj.reason === 'cross-site');
    assert(!!rejected, `cross-site record ${evilId} was rejected with reason 'cross-site'`);
    assert(evilResp.applied === 0, `cross-site push applied 0 records (got ${evilResp.applied})`);
    const evilOnCentral = await centralDb.selectFrom('fhir.fhir_resources').select('id').where('id', '=', evilId).executeTakeFirst();
    assert(!evilOnCentral, `cross-site resource ${evilId} was NOT written to central`);
    pass('(e) cross-site rejected, not applied');
  } catch (e) {
    if (failures === 0) failures++;
    console.error('\n[FAIL]', e instanceof Error ? e.stack : e);
  } finally {
    // Close instance handles BEFORE dropping (DROP DATABASE needs no live sessions; WITH FORCE backstops).
    try { await lab?.close(); } catch { /* ignore */ }
    try { await central?.close(); } catch { /* ignore */ }
    try { await centralTarget?.close(); } catch { /* ignore */ }
    try {
      await provisionDrop(adminDb, LAB_DB);
      await provisionDrop(adminDb, CENTRAL_DB);
      await provisionDrop(adminDb, CENTRAL_TARGET_DB);
    } catch (e) { console.error('  [cleanup] drop failed', e); }
    await admin.close();
  }

  if (failures === 0) {
    console.log('\n✅ sync:accept PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ sync:accept FAILED');
    process.exit(1);
  }
}

async function provisionDrop(admin: Kysely<unknown>, dbName: string): Promise<void> {
  await sql.raw(`drop database if exists ${dbName} with (force)`).execute(admin);
}

void main();
