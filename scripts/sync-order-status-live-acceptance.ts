// Two-Postgres integration proof for Distributed Sync S6c — the ORDER-STATUS round-trip (central → lab).
// A lab authors an ACTIVE ServiceRequest (a lab order) that is mirrored UP to central (S1 push, here
// simulated via applyRemote at origin version 1 + the lab's site_id). CENTRAL then changes that order's
// status to 'completed' via the GENERALIZED amend with activity='update' (a co-edit, not a result
// correction) — producing a new version + a Provenance whose activity code is 'UPDATE' + two
// sync_amendments outbox rows, all in one transaction. The lab then PULLS its amendment stream back DOWN
// and converges to the completed order — with the 'UPDATE' Provenance, the owning site_id preserved,
// site-scoped, and idempotent. Finally the lab drives its projection worker so the lab_requests
// READ-MODEL row for the order reflects status 'completed'.
//
// This is the S6c sibling of scripts/sync-amend-live-acceptance.ts (S6a, Observation result amendment).
// It reuses that harness's two-DB connect/provision/migrate/teardown + in-process serveAmendments drain
// VERBATIM, swapping the resource to a ServiceRequest and the activity to 'update', and adds a third DB
// (the lab's external analytics target) to prove the read-model projection converges too.
//
// DELIBERATE S6a/S6c SHORTCUT (flagged): the central pull-amendments endpoint's HTTP/JWKS transport +
// client-credentials auth + site-scoping principal are unit-proven; this harness does NOT stand up
// Fastify/JWKS. Instead the pull runner's `postPull` calls serveAmendments(centralCtx, SITE, fromSeq)
// IN-PROCESS — the SAME serve logic the POST /api/sync/pull-amendments route calls — with a minimal ctx
// stub `{ internalDb: centralDb, logger: console }` (serveAmendments only touches those two).
//
// Topology (three logical databases on :5433):
//   - openldr_s6c_central     : central internal DB (mirrors the lab order; authors the status change;
//                               owns sync_amendments)
//   - openldr_s6c_lab         : lab internal DB (owns the order; drains the amendment back down)
//   - openldr_s6c_lab_target  : lab external analytics target (the lab_requests read model) — the
//                               projection worker tails the lab internal change_log into it
//
// Each DB is dropped-if-exists then created fresh and migrated to latest, so the run is repeatable; a
// finally block drops all three.
//
// Preconditions: dev Postgres up on :5433 with the maintenance `openldr` DB.
//   docker compose up -d postgres
//
// Run: pnpm sync:order-status:accept
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
  createProjectionRunner,
  fetchSafeChangeRows,
  readCursor,
  internalMigrations,
  externalMigrations,
  type ExternalSchema,
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

const CENTRAL_DB = 'openldr_s6c_central';
const LAB_DB = 'openldr_s6c_lab';
const LAB_TARGET_DB = 'openldr_s6c_lab_target';
const SITE = 'lab-a';

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
const pass = (m: string) => console.log(`PASS: ${m}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const RUN_TAG = `s6c-accept-${Date.now()}`;
const orderId = `${RUN_TAG}-order`;

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

// An active lab order (the pre-status-change body): a CBC panel ServiceRequest for a patient. Central
// later flips status → 'completed' (fulfilled) via amend(activity:'update').
function activeOrder(): FhirResource {
  return {
    resourceType: 'ServiceRequest',
    id: orderId,
    status: 'active',
    intent: 'order',
    subject: { reference: 'Patient/s6c-pat' },
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
  let lab: ReturnType<typeof createInternalDb> | undefined;
  let labTarget: ReturnType<typeof createInternalDb> | undefined;

  try {
    step('0. provision + migrate three fresh databases on :5433');
    await provisionDb(adminDb, CENTRAL_DB);
    await provisionDb(adminDb, LAB_DB);
    await provisionDb(adminDb, LAB_TARGET_DB);
    ok(`created ${CENTRAL_DB}, ${LAB_DB}, ${LAB_TARGET_DB}`);

    central = createInternalDb(urlFor(CENTRAL_DB));
    lab = createInternalDb(urlFor(LAB_DB));
    labTarget = createInternalDb(urlFor(LAB_TARGET_DB));
    const centralDb = central.db;
    const labDb = lab.db;
    const labTargetDb = labTarget.db as unknown as Kysely<ExternalSchema>;

    await migrateInternal(centralDb as unknown as Kysely<unknown>);
    await migrateInternal(labDb as unknown as Kysely<unknown>);
    await migrateExternal(labTargetDb as unknown as Kysely<unknown>);
    ok('migrated central + lab (internal) + lab target (external) to latest');

    const centralStore = createFhirStore(centralDb);
    const labStore = createFhirStore(labDb);

    // ── 1. A lab authors an active ServiceRequest, mirrored UP to central (simulate the S1 push with
    //    applyRemote at origin version 1 + the lab's site_id). The lab keeps its OWN copy at v1 too so
    //    the status change has somewhere to land back down. Both change_log rows carry site_id=SITE,
    //    which is what makes central's amend() recognise the order as lab-owned. ──
    step('1. lab authors active ServiceRequest → mirrored up to central (applyRemote v1, siteId=SITE)');
    const seedRecord = {
      resourceType: 'ServiceRequest' as const,
      id: orderId,
      version: 1,
      op: 'upsert' as const,
      siteId: SITE,
      resource: activeOrder(),
    };
    const cenApply = await centralStore.applyRemote(seedRecord);
    const labApply = await labStore.applyRemote(seedRecord);
    assert(cenApply === 'applied', `central applied active ServiceRequest v1 (got ${cenApply})`);
    assert(labApply === 'applied', `lab applied its own active ServiceRequest v1 (got ${labApply})`);
    const seededCentral = await centralStore.get('ServiceRequest', orderId);
    assert((seededCentral as { status?: string } | null)?.status === 'active', `central ServiceRequest seeded as 'active'`);

    // ── 2. Central changes the lab-owned order's status → version 2, siteId preserved, activity='update' ──
    step('2. central changes the lab-owned order status (status=completed, activity=update)');
    const amendResult = await centralStore.amend({
      resourceType: 'ServiceRequest',
      id: orderId,
      status: 'completed',
      activity: 'update',
      agent: 'central-ops',
      reason: 'fulfilled',
    });
    ok(`amend → version=${amendResult.version}, provenanceId=${amendResult.provenanceId}, siteId=${amendResult.siteId}`);
    assert(amendResult.version === 2, `status change produced ServiceRequest version 2 (got ${amendResult.version})`);
    assert(amendResult.siteId === SITE, `status change routed to the owning lab '${SITE}' (got '${amendResult.siteId}')`);
    // Central wrote two sync_amendments outbox rows (the ServiceRequest v2 + its Provenance v1).
    const outbox = await centralDb.selectFrom('sync_amendments').selectAll().where('site_id', '=', SITE).execute();
    assert(outbox.length === 2, `central sync_amendments outbox has 2 rows for '${SITE}' (got ${outbox.length})`);

    // ── 3. In-process amendment drain: a lab-side pull runner whose postPull calls serveAmendments
    //    DIRECTLY (no HTTP — the flagged shortcut). Cursor kept in a local variable. applyRecord = the
    //    lab's applyRemote. serveAmendments only touches ctx.internalDb + ctx.logger. ──
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

    const applied1 = await runner.runCycle();
    ok(`drain cycle #1 applied ${applied1} record(s); cursor now ${amendCursor}`);
    assert(applied1 === 2, `lab applied 2 amendment records (ServiceRequest v2 + Provenance) (got ${applied1})`);

    // ── 4. Assertions at the lab: converged to the completed order, 'UPDATE' Provenance, site preserved ──
    step('4. assert lab converged: completed v2 + UPDATE Provenance + owning site preserved');
    const labOrder = (await labStore.get('ServiceRequest', orderId)) as Record<string, unknown> | null;
    assert(!!labOrder, `lab has ServiceRequest ${orderId} after drain`);
    assert(labOrder?.status === 'completed', `lab ServiceRequest status is 'completed' (got '${labOrder?.status}')`);
    assert(
      (labOrder?.meta as { versionId?: string } | undefined)?.versionId === '2',
      `lab ServiceRequest meta.versionId is '2' (got '${(labOrder?.meta as { versionId?: string } | undefined)?.versionId}')`,
    );
    const labOrderRow = await labDb
      .selectFrom('fhir.fhir_resources')
      .select('version')
      .where('resource_type', '=', 'ServiceRequest')
      .where('id', '=', orderId)
      .executeTakeFirst();
    assert(Number(labOrderRow?.version) === 2, `lab fhir_resources ServiceRequest is at version 2 (got ${labOrderRow?.version})`);

    const labProv = await labStore.get('Provenance', amendResult.provenanceId);
    assert(!!labProv, `lab has Provenance ${amendResult.provenanceId}`);
    const provTarget = (labProv as { target?: { reference?: string }[] } | null)?.target?.[0]?.reference;
    assert(provTarget === `ServiceRequest/${orderId}`, `lab Provenance targets ServiceRequest/${orderId} (got '${provTarget}')`);
    const provActivity = (labProv as { activity?: { coding?: { code?: string }[] } } | null)?.activity?.coding?.[0]?.code;
    assert(provActivity === 'UPDATE', `lab Provenance activity code is 'UPDATE' (got '${provActivity}')`);

    // The lab's change_log row for the amended version keeps the OWNING site_id (not re-stamped local).
    const labClRow = await labDb
      .selectFrom('fhir.change_log')
      .select('site_id')
      .where('resource_type', '=', 'ServiceRequest')
      .where('resource_id', '=', orderId)
      .where('version', '=', 2)
      .executeTakeFirst();
    assert(labClRow?.site_id === SITE, `lab change_log v2 row keeps owning site_id='${SITE}' (got '${labClRow?.site_id}')`);
    pass('lab converged to completed v2 with UPDATE Provenance, owning site preserved');

    // ── 5. Read-model projection: drive the lab's projection worker so lab_requests reflects the change ──
    //    The two-DB drain applies changes to the lab's canonical fhir.* via applyRemote but the async
    //    projection worker does not run automatically. Here we drive the SAME projection runner the
    //    projection acceptance uses (createProjectionRunner + fetchSafeChangeRows), tailing the lab's
    //    internal change_log into the lab's external lab_requests read model, then assert convergence.
    step('5. drive the lab projection worker → lab_requests read model reflects completed');
    const relationalWriter = createRelationalWriter(labTargetDb, 'postgres');
    const projRunner = createProjectionRunner({
      internalDb: labDb,
      fhirStore: labStore,
      relationalWriter,
      logger: projLogger,
      fetch: fetchSafeChangeRows,
      batchSize: 500,
    });
    const maxSeq = async (): Promise<number> => {
      const r = await labDb.selectFrom('fhir.change_log').select((eb) => eb.fn.max('seq').as('m')).executeTakeFirst();
      return r?.m != null ? Number(r.m) : 0;
    };
    const cursor = () => readCursor(labDb, 'projection');
    const target = await maxSeq();
    let c = await cursor();
    for (let i = 0; i < 200 && c < target; i++) {
      await projRunner.runCycle();
      c = await cursor();
      if (c < target) await sleep(25);
    }
    ok(`lab projection cursor at ${c} (max seq ${target})`);
    assert(c >= target, `lab projection cursor advanced to max(seq): cursor=${c} >= ${target}`);
    const lrRow = await labTargetDb
      .selectFrom('lab_requests')
      .select(['id', 'status', 'panel_code'])
      .where('id', '=', orderId)
      .executeTakeFirst();
    assert(!!lrRow, `lab_requests has a row for the order ${orderId}`);
    assert(lrRow?.status === 'completed', `lab_requests.status projected to 'completed' (got '${lrRow?.status}')`);
    assert(lrRow?.panel_code === '58410-2', `lab_requests.panel_code = '58410-2' (got '${lrRow?.panel_code}')`);
    pass('read-model projection: lab_requests converged to completed');

    // ── 6. Cross-site isolation: a different site's amendment stream is empty ──
    step('6. assert cross-site isolation: a foreign site drains 0 amendment records');
    const foreign = await serveAmendments(centralCtx, 'lab-b', 0);
    assert(foreign.records.length === 0, `serveAmendments for 'lab-b' returns 0 records (got ${foreign.records.length})`);
    pass('cross-site: foreign site sees nothing');

    // ── 7. Idempotent re-drain: a second cycle applies 0 and does not move the cursor ──
    step('7. assert idempotent re-drain: second cycle applies 0, cursor unchanged');
    const cursorBefore = amendCursor;
    const applied2 = await runner.runCycle();
    assert(applied2 === 0, `second drain cycle applied 0 records (got ${applied2})`);
    assert(amendCursor === cursorBefore, `cursor unchanged after idempotent re-drain (${amendCursor} === ${cursorBefore})`);
    pass('idempotent: no re-apply, no cursor drift');
  } catch (e) {
    if (failures === 0) failures++;
    console.error('\n[FAIL]', e instanceof Error ? e.stack : e);
  } finally {
    // Close instance handles BEFORE dropping (DROP DATABASE needs no live sessions; WITH FORCE backstops).
    try { await central?.close(); } catch { /* ignore */ }
    try { await lab?.close(); } catch { /* ignore */ }
    try { await labTarget?.close(); } catch { /* ignore */ }
    try {
      await provisionDrop(adminDb, CENTRAL_DB);
      await provisionDrop(adminDb, LAB_DB);
      await provisionDrop(adminDb, LAB_TARGET_DB);
    } catch (e) { console.error('  [cleanup] drop failed', e); }
    await admin.close();
  }

  if (failures === 0) {
    console.log('\n✅ sync:order-status:accept PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ sync:order-status:accept FAILED');
    process.exit(1);
  }
}

void main();
