// Live Postgres acceptance for the async projection worker (FHIR storage restructure — R2 Task 7).
//
// The projection worker tails `fhir.change_log` using a Postgres MVCC safe-frontier
// (system `xmin` vs `pg_snapshot_xmin(pg_current_snapshot())`). That watermark SQL —
// `fetchSafeChangeRows` in packages/db/src/projection/fetch.ts — CANNOT run under pg-mem, so it
// has no unit test. THIS script is its only real-Postgres proof. It exercises the REAL code paths
// against a live Postgres, in four phases:
//   1. Steady-state — save a Patient + Observation, run cycles, assert they project to the canonical
//      read-model (`patients`/`lab_results`) and the cursor catches up to max(seq).
//   2. Delete — delete the Patient, run cycles, assert the canonical row is tombstoned (removed).
//   3. Safe-frontier concurrency (the crux) — hold an UNCOMMITTED change_log + canonical insert
//      open in one connection while a later, committed Patient lands with a higher seq. Assert the
//      cursor does NOT advance to/past the held row's seq and neither the held nor the later
//      resource is projected (both sit at/after an in-flight xid). Then COMMIT the held txn, run
//      cycles, and assert both now project and the cursor advances — proving no-skip.
//   4. reprojectAll — delete the flat rows, rebuild from canonical, assert they come back.
//
// The held transaction is simulated WITHOUT a raw `pg` client (pg is not resolvable from the repo
// root): Kysely's `db.connection()` checks out a single connection; inside its callback we run a
// raw BEGIN + INSERTs (no COMMIT) and hold it open while OTHER operations run on the pool (separate
// connections with their own snapshots), then COMMIT. Both DB handles come from `createInternalDb`
// (which owns the `pg` import inside @openldr/db); the external handle is cast to ExternalSchema.
//
// Run-tagged resource ids (`proj-accept-<ts>-*`) keep the run idempotent without destroying dev
// data; a finally block still sweeps any `proj-accept-%` rows from both databases.
//
// Preconditions: dev Postgres up on :5433 with `openldr` (internal) + `openldr_target` (external).
//   docker compose up -d postgres
//
// Run: node_modules/.bin/tsx scripts/projection-live-acceptance.ts
//
// Env overrides:
//   INTERNAL_DATABASE_URL (postgres://openldr:openldr@localhost:5433/openldr)
//   TARGET_DATABASE_URL   (postgres://openldr:openldr@localhost:5433/openldr_target)
import { type Kysely, sql } from 'kysely';
import {
  createInternalDb,
  createFhirStore,
  createRelationalWriter,
  createMigrator,
  internalMigrations,
  externalMigrations,
  createProjectionRunner,
  reprojectAll,
  fetchSafeChangeRows,
  readCursor,
  type ExternalSchema,
  type InternalSchema,
} from '@openldr/db';

const INTERNAL_URL = process.env.INTERNAL_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr';
const TARGET_URL = process.env.TARGET_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr_target';

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
const pass = (m: string) => console.log(`PASS: ${m}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Surface real projection-apply failures (they would be findings), stay quiet otherwise.
const logger = {
  info() {},
  warn() {},
  debug() {},
  error(o: unknown, m?: string) { console.error('  [projection.error]', m ?? '', o); },
};

const RUN_TAG = `proj-accept-${Date.now()}`;
const patientId = `${RUN_TAG}-pat`;
const obsId = `${RUN_TAG}-obs`;
const heldId = `${RUN_TAG}-held`;
const laterId = `${RUN_TAG}-later`;
const v2PatId = `${RUN_TAG}-v2pat`;
const v2SrId = `${RUN_TAG}-v2sr`;
const v2ObsId = `${RUN_TAG}-v2obs`;
const v2OrgId = `${RUN_TAG}-v2org`;

async function main() {
  const internal = createInternalDb(INTERNAL_URL);
  const internalDb = internal.db;
  const external = createInternalDb(TARGET_URL);
  const externalDb = external.db as unknown as Kysely<ExternalSchema>;
  const fhirStore = createFhirStore(internalDb);
  // The projection worker writes ONLY the canonical relational read model (the thin flat sink was
  // removed in R3e Task 2). One writer, one target DB.
  const relationalWriter = createRelationalWriter(externalDb, 'postgres');
  // Create the stateful runner ONCE — its pendingGaps frontier state must persist across every
  // runCycle() call (this is exactly what the no-skip guarantee in Phase 3 depends on).
  const runner = createProjectionRunner({ internalDb, fhirStore, relationalWriter, logger, fetch: fetchSafeChangeRows, batchSize: 500 });

  const cursor = () => readCursor(internalDb, 'projection');
  const maxSeq = async (): Promise<number> => {
    const r = await internalDb.selectFrom('fhir.change_log').select((eb) => eb.fn.max('seq').as('m')).executeTakeFirst();
    return r?.m != null ? Number(r.m) : 0;
  };
  const seqFor = async (resourceId: string): Promise<number> => {
    const r = await internalDb
      .selectFrom('fhir.change_log')
      .select((eb) => eb.fn.max('seq').as('m'))
      .where('resource_id', '=', resourceId)
      .executeTakeFirst();
    return r?.m != null ? Number(r.m) : 0;
  };
  const patientExists = async (id: string): Promise<boolean> =>
    !!(await externalDb.selectFrom('patients').select('id').where('id', '=', id).executeTakeFirst());
  const observationExists = async (id: string): Promise<boolean> =>
    !!(await externalDb.selectFrom('lab_results').select('id').where('id', '=', id).executeTakeFirst());

  // Run cycles until the cursor reaches `target` (committed steady state) or we give up.
  async function drainUntil(target: number, maxIters = 200): Promise<number> {
    let c = await cursor();
    for (let i = 0; i < maxIters && c < target; i++) {
      await runner.runCycle();
      c = await cursor();
      if (c < target) await sleep(25);
    }
    return c;
  }

  let failures = 0;
  const assert = (cond: boolean, detail: string) => {
    if (cond) { ok(detail); return; }
    failures++;
    console.error(`FAIL: ${detail}`);
    throw new Error(detail);
  };

  try {
    step('0. migrate internal + external to latest');
    const im = await createMigrator(internalDb as unknown as Kysely<unknown>, internalMigrations).migrateToLatest();
    if (im.error) throw im.error;
    const em = await createMigrator(externalDb as unknown as Kysely<unknown>, externalMigrations('postgres')).migrateToLatest();
    if (em.error) throw em.error;
    ok(`internal: ${(im.results ?? []).length} applied/current; external: ${(em.results ?? []).length} applied/current`);

    // Reach steady state against any pre-existing dev data so later phase deltas are crisp.
    step('warmup — drain pre-existing change_log to steady state');
    const warm = await drainUntil(await maxSeq());
    ok(`cursor at ${warm} (max seq ${await maxSeq()})`);

    // ── Phase 1: steady-state projection ──
    step('1. steady-state: save Patient + Observation → project');
    await fhirStore.save({ resourceType: 'Patient', id: patientId, name: [{ family: 'Frontier', given: ['Ada'] }], gender: 'female', birthDate: '1985-04-12' } as never);
    await fhirStore.save({ resourceType: 'Observation', id: obsId, status: 'final', code: { text: 'CBC' }, subject: { reference: `Patient/${patientId}` } } as never);
    const target1 = await maxSeq();
    const c1 = await drainUntil(target1);
    assert(c1 >= target1, `cursor advanced to max(seq): cursor=${c1} >= ${target1}`);
    assert(await patientExists(patientId), `Patient ${patientId} projected to canonical patients`);
    assert(await observationExists(obsId), `Observation ${obsId} projected to canonical lab_results`);
    pass('phase 1 — steady-state projection');

    // ── Phase 2: delete / tombstone ──
    step('2. delete: fhirStore.delete(Patient) → canonical row removed');
    const del = await fhirStore.delete('Patient', patientId);
    assert(del.deleted === true, `canonical Patient ${patientId} deleted (v${del.version})`);
    const target2 = await maxSeq();
    const c2 = await drainUntil(target2);
    assert(c2 >= target2, `cursor advanced past delete: cursor=${c2} >= ${target2}`);
    assert(!(await patientExists(patientId)), `canonical patients row for ${patientId} is gone (tombstoned)`);
    pass('phase 2 — delete/tombstone');

    // ── Phase 3: safe-frontier concurrency (the crux) ──
    step('3. safe-frontier: uncommitted change_log must not project and must not advance the cursor');
    // Drain to exact steady state so the held row's seq is precisely one past the cursor.
    const preHeld = await drainUntil(await maxSeq());
    ok(`pre-held cursor=${preHeld}`);

    // Hold an uncommitted txn open on a single checked-out connection: BEGIN + canonical insert +
    // change_log insert, NO COMMIT. Inside the same callback we run projection cycles on the POOL
    // (separate connections) so their snapshots see this txn as in-flight, then COMMIT.
    await internalDb.connection().execute(async (heldConn) => {
      await sql`begin`.execute(heldConn);
      // Canonical row for heldId in the held txn (so it COULD project if it were visible/safe).
      await sql`
        insert into fhir.fhir_resources (resource_type, id, version, version_id, resource)
        values ('Patient', ${heldId}, 1, '1', ${JSON.stringify({ resourceType: 'Patient', id: heldId, name: [{ family: 'Held' }] })}::jsonb)
      `.execute(heldConn);
      const hr = await sql<{ seq: string }>`
        insert into fhir.change_log (resource_type, resource_id, version, op)
        values ('Patient', ${heldId}, 1, 'upsert') returning seq
      `.execute(heldConn);
      const heldSeq = Number(hr.rows[0]!.seq);
      ok(`held (uncommitted) change_log seq=${heldSeq}`);

      // A SEPARATE, committed Patient with a higher seq (uses the pool, not the held connection).
      await fhirStore.save({ resourceType: 'Patient', id: laterId, name: [{ family: 'Later' }] } as never);
      const laterSeq = await seqFor(laterId);
      assert(laterSeq > heldSeq, `later committed seq ${laterSeq} > held seq ${heldSeq}`);

      // Run cycles while the held txn is still open.
      for (let i = 0; i < 5; i++) { await runner.runCycle(); await sleep(20); }
      const cHeld = await cursor();
      // The STRONG invariant: cursor did not reach/pass the held seq, and neither resource projected.
      assert(cHeld < heldSeq, `cursor did NOT advance to/past held seq: cursor=${cHeld} < ${heldSeq}`);
      assert(cHeld === preHeld, `cursor stayed at pre-held watermark ${preHeld} (got ${cHeld})`);
      assert(!(await patientExists(heldId)), `held resource ${heldId} NOT projected while in-flight`);
      assert(!(await patientExists(laterId)), `later resource ${laterId} NOT projected (behind the in-flight frontier)`);
      ok('in-flight change deferred: no projection, no cursor advance, no skip');

      await sql`commit`.execute(heldConn);
    });

    // After COMMIT the frontier moves past both txns; both rows are now safe.
    const target3 = await maxSeq();
    const c3 = await drainUntil(target3);
    assert(c3 >= target3, `cursor advanced after commit: cursor=${c3} >= ${target3}`);
    assert(await patientExists(heldId), `held resource ${heldId} projected after commit`);
    assert(await patientExists(laterId), `later resource ${laterId} projected after commit`);
    pass('phase 3 — safe-frontier concurrency (no-skip proven)');

    // ── Phase 4: reprojectAll rebuilds from canonical ──
    step('4. reprojectAll: delete read-model rows then rebuild from canonical');
    await externalDb.deleteFrom('lab_results').where('id', '=', obsId).execute();
    await externalDb.deleteFrom('patients').where('id', 'in', [heldId, laterId]).execute();
    assert(!(await observationExists(obsId)), `canonical lab_results row ${obsId} removed pre-reproject`);
    assert(!(await patientExists(heldId)), `canonical patients row ${heldId} removed pre-reproject`);
    const rebuilt = await reprojectAll({ internalDb, relationalWriter });
    ok(`reprojectAll rebuilt ${rebuilt} canonical resource(s)`);
    assert(await observationExists(obsId), `Observation ${obsId} rebuilt from canonical`);
    assert(await patientExists(heldId), `Patient ${heldId} rebuilt from canonical`);
    assert(await patientExists(laterId), `Patient ${laterId} rebuilt from canonical`);
    assert((await cursor()) === (await maxSeq()), `reprojectAll set cursor to max seq (${await maxSeq()})`);
    pass('phase 4 — reprojectAll');

    // ── Phase 5: canonical relational projection ──
    step('5. canonical: Patient/ServiceRequest/Observation/Organization → canonical relational tables');
    // Save a small connected graph: Organization (facility), Patient, a ServiceRequest ordered for the
    // Patient (soft ref subject), and an Observation based on that ServiceRequest (soft ref basedOn).
    await fhirStore.save({
      resourceType: 'Organization', id: v2OrgId,
      identifier: [{ system: 'urn:facility', value: 'FAC-001' }], name: 'Central Reference Lab',
    } as never);
    await fhirStore.save({
      resourceType: 'Patient', id: v2PatId,
      identifier: [{ system: 'urn:patient', value: 'PID-9001' }],
      name: [{ family: 'Relational', given: ['Bob'] }], gender: 'male', birthDate: '1978-02-03',
    } as never);
    await fhirStore.save({
      resourceType: 'ServiceRequest', id: v2SrId, status: 'active', intent: 'order',
      subject: { reference: `Patient/${v2PatId}` },
      code: { coding: [{ system: 'http://loinc.org', code: '58410-2', display: 'CBC panel' }] },
    } as never);
    await fhirStore.save({
      resourceType: 'Observation', id: v2ObsId, status: 'final',
      basedOn: [{ reference: `ServiceRequest/${v2SrId}` }],
      code: { coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] },
      valueQuantity: { value: 13.5, unit: 'g/dL' },
    } as never);
    const target5 = await maxSeq();
    const c5 = await drainUntil(target5);
    assert(c5 >= target5, `cursor advanced to max(seq): cursor=${c5} >= ${target5}`);

    const v2Pat = await externalDb.selectFrom('patients')
      .select(['id', 'surname', 'sex', 'patient_guid']).where('id', '=', v2PatId).executeTakeFirst();
    assert(!!v2Pat, `patients has row for ${v2PatId}`);
    assert(v2Pat?.surname === 'Relational', `patients.surname = 'Relational' (got ${v2Pat?.surname})`);
    assert(v2Pat?.sex === 'M', `patients.sex = 'M' (male) (got ${v2Pat?.sex})`);
    assert(v2Pat?.patient_guid === 'PID-9001', `patients.patient_guid = 'PID-9001' (got ${v2Pat?.patient_guid})`);

    const v2Req = await externalDb.selectFrom('lab_requests')
      .select(['id', 'patient_id', 'panel_code', 'panel_system']).where('id', '=', v2SrId).executeTakeFirst();
    assert(!!v2Req, `lab_requests has row for ${v2SrId}`);
    assert(v2Req?.patient_id === v2PatId, `lab_requests.patient_id soft-refs Patient FHIR id ${v2PatId} (got ${v2Req?.patient_id})`);
    assert(v2Req?.panel_code === '58410-2', `lab_requests.panel_code = '58410-2' (got ${v2Req?.panel_code})`);
    assert(v2Req?.panel_system === 'http://loinc.org', `lab_requests.panel_system = 'http://loinc.org' (got ${v2Req?.panel_system})`);

    const v2Res = await externalDb.selectFrom('lab_results')
      .select(['id', 'request_id', 'observation_code']).where('id', '=', v2ObsId).executeTakeFirst();
    assert(!!v2Res, `lab_results has row for ${v2ObsId}`);
    assert(v2Res?.request_id === v2SrId, `lab_results.request_id soft-refs ServiceRequest FHIR id ${v2SrId} (got ${v2Res?.request_id})`);
    assert(v2Res?.observation_code === '718-7', `lab_results.observation_code = '718-7' (got ${v2Res?.observation_code})`);

    const v2Fac = await externalDb.selectFrom('facilities')
      .select(['id', 'facility_code', 'facility_name', 'source_resource']).where('id', '=', v2OrgId).executeTakeFirst();
    assert(!!v2Fac, `facilities has row for ${v2OrgId}`);
    assert(v2Fac?.source_resource === 'Organization', `facilities.source_resource = 'Organization' (got ${v2Fac?.source_resource})`);
    assert(v2Fac?.facility_code === 'FAC-001', `facilities.facility_code = 'FAC-001' (got ${v2Fac?.facility_code})`);

    // Canonical tombstone delete path: deleting the canonical Patient removes its patients row.
    const v2Del = await fhirStore.delete('Patient', v2PatId);
    assert(v2Del.deleted === true, `canonical Patient ${v2PatId} deleted (v${v2Del.version})`);
    const c5d = await drainUntil(await maxSeq());
    const v2PatGone = await externalDb.selectFrom('patients').select('id').where('id', '=', v2PatId).executeTakeFirst();
    assert(!v2PatGone, `patients row for ${v2PatId} is gone after delete (cursor=${c5d})`);
    pass('phase 5 — canonical projection');
  } catch (e) {
    if (failures === 0) failures++;
    console.error('\n[FAIL]', e instanceof Error ? e.stack : e);
  } finally {
    // Sweep this run's (and any prior run's) tagged rows from both databases so the script repeats.
    try {
      await externalDb.deleteFrom('patients').where('id', 'like', 'proj-accept-%').execute();
      await externalDb.deleteFrom('lab_requests').where('id', 'like', 'proj-accept-%').execute();
      await externalDb.deleteFrom('lab_results').where('id', 'like', 'proj-accept-%').execute();
      await externalDb.deleteFrom('facilities').where('id', 'like', 'proj-accept-%').execute();
    } catch { /* ignore cleanup errors */ }
    try {
      await sql`delete from fhir.change_log where resource_id like 'proj-accept-%'`.execute(internalDb);
      await sql`delete from fhir.resource_history where id like 'proj-accept-%'`.execute(internalDb);
      await sql`delete from fhir.fhir_resources where id like 'proj-accept-%'`.execute(internalDb);
    } catch { /* ignore cleanup errors */ }
    await internal.close();
    await external.close();
  }

  console.log(failures === 0 ? '\n✅ Projection live acceptance PASSED' : '\n❌ Projection live acceptance FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

void main();
