// Four-Postgres integration proof for Distributed Sync S6b — the intra-lab PATIENT-MERGE round-trip.
// A lab has a duplicate patient (`p-dup`) plus lab data (an Observation `obs-1` and a ServiceRequest
// `sr-1`) both pointing at that duplicate. Those resources are mirrored UP to central (S1 push, here
// simulated via applyRemote at origin version 1 + the lab's site_id). CENTRAL runs the merge
// ORCHESTRATOR (`mergePatients` from @openldr/bootstrap): it enumerates the referencing refs from its
// OWN projected read model (the external target DB) and delegates the atomic cascade to
// fhirStore.mergePatients — marking `p-dup` replaced (active:false + replaced-by → `p-surv`),
// re-pointing obs-1 + sr-1 onto the survivor, writing one 'MERGE' Provenance, and emitting four
// sync_amendments outbox rows, all in one transaction. The lab then PULLS its amendment stream back
// DOWN and converges: the duplicate goes inactive with a replaced-by link, its lab data re-attributes
// to the survivor, and the merge Provenance lands. Finally the lab drives its projection worker so the
// read model unifies too — lab_results / lab_requests .patient_id become the survivor and the patients
// row for the duplicate is marked (active=false, replaced_by_id=survivor).
//
// This is the S6b sibling of scripts/sync-order-status-live-acceptance.ts (S6c, order-status co-edit).
// It reuses that harness's two-DB connect/provision/migrate/teardown + in-process serveAmendments drain
// + projection-drive VERBATIM, swapping the co-edit for the merge orchestrator, and adds a FOURTH DB:
// a CENTRAL external analytics target. That central target is REQUIRED — the orchestrator enumerates
// the resources referencing the duplicate from `ctx.store.db` (the external read model), so central must
// have PROJECTED obs-1 + sr-1 (with patient_id = p-dup) into it BEFORE the merge is authored.
//
// DELIBERATE S6a/S6c SHORTCUT (flagged): the central pull-amendments endpoint's HTTP/JWKS transport +
// client-credentials auth + site-scoping principal are unit-proven; this harness does NOT stand up
// Fastify/JWKS. Instead the pull runner's `postPull` calls serveAmendments(centralCtx2, SITE, fromSeq)
// IN-PROCESS — the SAME serve logic the POST /api/sync/pull-amendments route calls — with a minimal ctx
// stub `{ internalDb: centralInternal, logger }` (serveAmendments only touches those two).
//
// Topology (four logical databases on :5433):
//   - openldr_s6b_central          : central internal DB (mirrors the lab; authors the merge; owns outbox)
//   - openldr_s6b_central_target   : central external analytics target — the reverse-index the
//                                    orchestrator enumerates (lab_results/lab_requests.patient_id=p-dup)
//   - openldr_s6b_lab              : lab internal DB (owns the resources; drains the merge back down)
//   - openldr_s6b_lab_target       : lab external analytics target (the unified read model post-merge)
//
// Each DB is dropped-if-exists then created fresh and migrated to latest, so the run is repeatable; a
// finally block drops all four.
//
// Preconditions: dev Postgres up on :5433 with the maintenance `openldr` DB.
//   docker compose up -d postgres
//
// Run: pnpm sync:patient-merge:accept
//
// Env override:
//   ADMIN_DATABASE_URL (postgres://openldr:openldr@localhost:5433/openldr) — maintenance DB used to
//   CREATE/DROP the four test databases.
import { type Kysely, sql } from 'kysely';
import {
  createInternalDb,
  createFhirStore,
  createRelationalWriter,
  createMigrator,
  createProjectionRunner,
  fetchSafeChangeRows,
  readCursor,
  internalMigrations,
  externalMigrations,
  type ExternalSchema,
} from '@openldr/db';
import { serveAmendments, mergePatients } from '@openldr/bootstrap';
import { createAmendmentPullRunner, type PullRequest, type AmendmentPullResponse } from '@openldr/sync';
import type { FhirResource } from '@openldr/fhir';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr';
const urlFor = (dbName: string): string => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
};

const CENTRAL_DB = 'openldr_s6b_central';
const CENTRAL_TARGET_DB = 'openldr_s6b_central_target';
const LAB_DB = 'openldr_s6b_lab';
const LAB_TARGET_DB = 'openldr_s6b_lab_target';
const SITE = 'lab-a';

const SURV = 'p-surv';
const DUP = 'p-dup';
const OBS = 'obs-1';
const SR = 'sr-1';

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
const pass = (m: string) => console.log(`PASS: ${m}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Surface real projection-apply failures (they would be findings), stay quiet otherwise.
const projLogger = {
  info() {},
  warn() {},
  debug() {},
  error(o: unknown, m?: string) { console.error('  [projection.error]', m ?? '', o); },
};

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

async function migrateExternal(db: Kysely<unknown>): Promise<void> {
  const r = await createMigrator(db, externalMigrations('postgres')).migrateToLatest();
  if (r.error) throw r.error;
}

// Drive a projection runner (internal change_log → external read model) until its 'projection' cursor
// catches up to max(seq). Same idiom as the S6c sibling; parameterized so both central + lab can use it.
async function driveProjection(
  internalDb: Kysely<never>,
  fhirStore: ReturnType<typeof createFhirStore>,
  targetDb: Kysely<ExternalSchema>,
): Promise<void> {
  const relationalWriter = createRelationalWriter(targetDb, 'postgres');
  const projRunner = createProjectionRunner({
    internalDb,
    fhirStore,
    relationalWriter,
    logger: projLogger,
    fetch: fetchSafeChangeRows,
    batchSize: 500,
  });
  const maxSeq = async (): Promise<number> => {
    const r = await internalDb.selectFrom('fhir.change_log').select((eb) => eb.fn.max('seq').as('m')).executeTakeFirst();
    return r?.m != null ? Number(r.m) : 0;
  };
  const cursor = () => readCursor(internalDb, 'projection');
  const target = await maxSeq();
  let c = await cursor();
  for (let i = 0; i < 200 && c < target; i++) {
    await projRunner.runCycle();
    c = await cursor();
    if (c < target) await sleep(25);
  }
  if (c < target) throw new Error(`projection cursor stalled at ${c} (max seq ${target})`);
}

function patient(id: string): FhirResource {
  return { resourceType: 'Patient', id, active: true, name: [{ family: id }] } as unknown as FhirResource;
}
// An Observation for the duplicate patient (a lab result referencing Patient/p-dup).
function observation(): FhirResource {
  return {
    resourceType: 'Observation',
    id: OBS,
    status: 'final',
    subject: { reference: `Patient/${DUP}` },
    code: { coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] },
    valueQuantity: { value: 13.5, unit: 'g/dL' },
    effectiveDateTime: '2026-05-02T00:00:00Z',
  } as unknown as FhirResource;
}
// A ServiceRequest (a lab order) for the duplicate patient.
function serviceRequest(): FhirResource {
  return {
    resourceType: 'ServiceRequest',
    id: SR,
    status: 'active',
    intent: 'order',
    subject: { reference: `Patient/${DUP}` },
    code: { coding: [{ system: 'http://loinc.org', code: '58410-2', display: 'CBC panel' }] },
    authoredOn: '2026-05-02T00:00:00Z',
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
  let centralTarget: ReturnType<typeof createInternalDb> | undefined;
  let lab: ReturnType<typeof createInternalDb> | undefined;
  let labTarget: ReturnType<typeof createInternalDb> | undefined;

  try {
    step('0. provision + migrate four fresh databases on :5433');
    await provisionDb(adminDb, CENTRAL_DB);
    await provisionDb(adminDb, CENTRAL_TARGET_DB);
    await provisionDb(adminDb, LAB_DB);
    await provisionDb(adminDb, LAB_TARGET_DB);
    ok(`created ${CENTRAL_DB}, ${CENTRAL_TARGET_DB}, ${LAB_DB}, ${LAB_TARGET_DB}`);

    central = createInternalDb(urlFor(CENTRAL_DB));
    centralTarget = createInternalDb(urlFor(CENTRAL_TARGET_DB));
    lab = createInternalDb(urlFor(LAB_DB));
    labTarget = createInternalDb(urlFor(LAB_TARGET_DB));
    const centralDb = central.db;
    const centralTargetDb = centralTarget.db as unknown as Kysely<ExternalSchema>;
    const labDb = lab.db;
    const labTargetDb = labTarget.db as unknown as Kysely<ExternalSchema>;

    await migrateInternal(centralDb as unknown as Kysely<unknown>);
    await migrateExternal(centralTargetDb as unknown as Kysely<unknown>);
    await migrateInternal(labDb as unknown as Kysely<unknown>);
    await migrateExternal(labTargetDb as unknown as Kysely<unknown>);
    ok('migrated central + lab (internal) + central target + lab target (external) to latest');

    const centralStore = createFhirStore(centralDb);
    const labStore = createFhirStore(labDb);

    // ── 1. Seed the duplicate-patient scenario at v1 (siteId=SITE) into BOTH central and lab internal
    //    DBs. applyRemote mirrors each change at its ORIGIN version/site, so central recognizes the
    //    resources as lab-owned (that same-site ownership is what the merge primitive guards on). ──
    step('1. seed p-surv, p-dup, obs-1, sr-1 (all v1, siteId=SITE) into central + lab internal DBs');
    const seeds: { resourceType: FhirResource['resourceType']; id: string; resource: FhirResource }[] = [
      { resourceType: 'Patient', id: SURV, resource: patient(SURV) },
      { resourceType: 'Patient', id: DUP, resource: patient(DUP) },
      { resourceType: 'Observation', id: OBS, resource: observation() },
      { resourceType: 'ServiceRequest', id: SR, resource: serviceRequest() },
    ];
    for (const s of seeds) {
      const rec = { resourceType: s.resourceType as never, id: s.id, version: 1, op: 'upsert' as const, siteId: SITE, resource: s.resource };
      const cen = await centralStore.applyRemote(rec);
      const lb = await labStore.applyRemote(rec);
      assert(cen === 'applied', `central applied ${s.resourceType}/${s.id} v1 (got ${cen})`);
      assert(lb === 'applied', `lab applied ${s.resourceType}/${s.id} v1 (got ${lb})`);
    }

    // ── 2. Project CENTRAL (central internal → central target) so the orchestrator's reverse-index
    //    enumeration finds obs-1 + sr-1 by patient_id=p-dup. THIS is why central needs a target DB. ──
    step('2. drive CENTRAL projection → central lab_results/lab_requests.patient_id = p-dup (enumeration source)');
    await driveProjection(centralDb as unknown as Kysely<never>, centralStore, centralTargetDb);
    const cLr = await centralTargetDb.selectFrom('lab_results').select(['id', 'patient_id']).where('id', '=', OBS).executeTakeFirst();
    const cReq = await centralTargetDb.selectFrom('lab_requests').select(['id', 'patient_id']).where('id', '=', SR).executeTakeFirst();
    assert(cLr?.patient_id === DUP, `central lab_results.patient_id for ${OBS} = '${DUP}' (got '${cLr?.patient_id}')`);
    assert(cReq?.patient_id === DUP, `central lab_requests.patient_id for ${SR} = '${DUP}' (got '${cReq?.patient_id}')`);

    // ── 3. Author the merge at central via the ORCHESTRATOR. It enumerates referencing refs from
    //    centralCtx.store.db (= central target) then delegates to fhirStore.mergePatients. The minimal
    //    ctx only needs { store: { db }, fhirStore } — the fields the orchestrator touches. ──
    step('3. author the merge at central via the orchestrator (mergePatients)');
    const centralCtx = { store: { db: centralTargetDb }, fhirStore: centralStore } as never;
    const result = await mergePatients(centralCtx, { survivorId: SURV, duplicateId: DUP, agent: 'mpi', reason: 'same person' });
    ok(`merge → repointed=${result.repointed}, provenanceId=${result.provenanceId}, siteId=${result.siteId}`);
    assert(result.repointed === 2, `merge re-pointed 2 referencing resources (got ${result.repointed})`);
    assert(result.siteId === SITE, `merge routed to the owning lab '${SITE}' (got '${result.siteId}')`);
    // Central wrote four sync_amendments outbox rows (Patient v2 + Observation v2 + ServiceRequest v2 + Provenance v1).
    const outbox = await centralDb.selectFrom('sync_amendments').selectAll().where('site_id', '=', SITE).execute();
    assert(outbox.length === 4, `central sync_amendments outbox has 4 rows for '${SITE}' (got ${outbox.length})`);

    // ── 4. In-process amendment drain: a lab-side pull runner whose postPull calls serveAmendments
    //    DIRECTLY (no HTTP — the flagged shortcut). Cursor kept in a local variable. applyRecord = the
    //    lab's applyRemote. serveAmendments only touches ctx.internalDb + ctx.logger. ──
    step('4. lab drains its amendment stream in-process (serveAmendments → applyRemote)');
    const centralCtx2 = { internalDb: centralDb, logger: console } as never;
    let amendCursor = 0;
    const runner = createAmendmentPullRunner({
      getToken: async () => 'dummy-token', // no HTTP/JWKS in this harness (flagged shortcut)
      postPull: (req: PullRequest): Promise<AmendmentPullResponse> =>
        serveAmendments(centralCtx2, SITE, typeof req.fromSeq === 'number' ? req.fromSeq : 0),
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
    assert(cycle1.applied === 4, `lab applied 4 amendment records (Patient v2 + obs-1 v2 + sr-1 v2 + Provenance) (got ${cycle1.applied})`);
    assert(cycle1.outcome === 'progressed', `drain cycle #1 reports outcome 'progressed' (got '${cycle1.outcome}')`);

    // ── 5. Lab convergence (FHIR): duplicate replaced + inactive, lab data re-pointed, MERGE Provenance ──
    step('5. assert lab converged (FHIR): duplicate replaced, obs-1/sr-1 re-pointed, MERGE Provenance');
    const dup = (await labStore.get('Patient', DUP)) as Record<string, unknown> | null;
    assert(!!dup, `lab has Patient ${DUP} after drain`);
    assert(dup?.active === false, `lab Patient ${DUP} is active:false (got ${JSON.stringify(dup?.active)})`);
    const dupLinks = (dup?.link as { type?: string; other?: { reference?: string } }[] | undefined) ?? [];
    const replacedBy = dupLinks.find((l) => l.type === 'replaced-by')?.other?.reference;
    assert(replacedBy === `Patient/${SURV}`, `lab Patient ${DUP} has replaced-by → Patient/${SURV} (got '${replacedBy}')`);

    const obs = (await labStore.get('Observation', OBS)) as Record<string, unknown> | null;
    assert((obs?.subject as { reference?: string } | undefined)?.reference === `Patient/${SURV}`,
      `lab Observation ${OBS} subject re-pointed to Patient/${SURV} (got '${(obs?.subject as { reference?: string } | undefined)?.reference}')`);
    const sr = (await labStore.get('ServiceRequest', SR)) as Record<string, unknown> | null;
    assert((sr?.subject as { reference?: string } | undefined)?.reference === `Patient/${SURV}`,
      `lab ServiceRequest ${SR} subject re-pointed to Patient/${SURV} (got '${(sr?.subject as { reference?: string } | undefined)?.reference}')`);

    const prov = (await labStore.get('Provenance', result.provenanceId)) as Record<string, unknown> | null;
    assert(!!prov, `lab has merge Provenance ${result.provenanceId}`);
    const provActivity = (prov as { activity?: { coding?: { code?: string }[] } } | null)?.activity?.coding?.[0]?.code;
    assert(provActivity === 'MERGE', `lab merge Provenance activity code is 'MERGE' (got '${provActivity}')`);
    pass('lab converged (FHIR): duplicate replaced+inactive, lab data re-pointed, MERGE Provenance landed');

    // ── 6. Read-model projection: drive the lab's projection worker so the read model unifies too ──
    step('6. drive the LAB projection worker → read model unifies onto the survivor');
    await driveProjection(labDb as unknown as Kysely<never>, labStore, labTargetDb);
    const lrObs = await labTargetDb.selectFrom('lab_results').select(['id', 'patient_id']).where('id', '=', OBS).executeTakeFirst();
    assert(lrObs?.patient_id === SURV, `lab lab_results.patient_id for ${OBS} unified to '${SURV}' (got '${lrObs?.patient_id}')`);
    const lrReq = await labTargetDb.selectFrom('lab_requests').select(['id', 'patient_id']).where('id', '=', SR).executeTakeFirst();
    assert(lrReq?.patient_id === SURV, `lab lab_requests.patient_id for ${SR} unified to '${SURV}' (got '${lrReq?.patient_id}')`);
    const dupRow = await labTargetDb.selectFrom('patients').select(['id', 'active', 'replaced_by_id']).where('id', '=', DUP).executeTakeFirst();
    assert(!!dupRow, `lab patients has a row for the duplicate ${DUP}`);
    assert(dupRow?.active === false, `lab patients.active for ${DUP} is false (got ${JSON.stringify(dupRow?.active)})`);
    assert(dupRow?.replaced_by_id === SURV, `lab patients.replaced_by_id for ${DUP} = '${SURV}' (got '${dupRow?.replaced_by_id}')`);
    pass('read-model projection: lab_results/lab_requests re-attributed + duplicate marked replaced');

    // ── 7. Cross-site isolation: a different site's amendment stream is empty ──
    step('7. assert cross-site isolation: a foreign site drains 0 amendment records');
    const foreign = await serveAmendments(centralCtx2, 'lab-b', 0);
    assert(foreign.records.length === 0, `serveAmendments for 'lab-b' returns 0 records (got ${foreign.records.length})`);
    pass('cross-site: foreign site sees nothing');

    // ── 8. Idempotent re-drain: a second cycle applies 0 and does not move the cursor ──
    step('8. assert idempotent re-drain: second cycle applies 0, cursor unchanged');
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
    try { await centralTarget?.close(); } catch { /* ignore */ }
    try { await lab?.close(); } catch { /* ignore */ }
    try { await labTarget?.close(); } catch { /* ignore */ }
    try {
      await provisionDrop(adminDb, CENTRAL_DB);
      await provisionDrop(adminDb, CENTRAL_TARGET_DB);
      await provisionDrop(adminDb, LAB_DB);
      await provisionDrop(adminDb, LAB_TARGET_DB);
    } catch (e) { console.error('  [cleanup] drop failed', e); }
    await admin.close();
  }

  if (failures === 0) {
    console.log('\n✅ sync:patient-merge:accept PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ sync:patient-merge:accept FAILED');
    process.exit(1);
  }
}

void main();
