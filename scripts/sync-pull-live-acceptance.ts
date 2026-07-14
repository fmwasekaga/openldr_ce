// Two-Postgres integration proof for Distributed Sync S2 — the reference-data PULL round-trip
// (central → lab). A CENTRAL instance authors reference config (dashboard, report, published form,
// center-owned feature-flag setting) through the CAPTURING config stores, so each write appends a
// row to `reference_change_log`. A LAB then PULLS that delta and mirror-applies it via the reference
// applier — every managed row stamped `managed_origin='central'`, deletes guarded by that stamp so a
// lab-local row is never touched, and the whole stream idempotent.
//
// This is a REAL-Postgres harness (not pg-mem): reference_change_log's bigserial `seq`, the pull
// window read (seq-ordered dedup-to-latest), and the applier's ON CONFLICT upserts all exercise real
// PG semantics. It mirrors scripts/sync-live-acceptance.ts (the S1 push harness): create fresh DBs on
// :5433, migrate to latest, construct createInternalDb handles, drive the runner to completion,
// assert against the target tables, and drop the DBs in a finally.
//
// DELIBERATE S2 SHORTCUT (flagged): the pull endpoint's HTTP/JWKS transport + client-credentials auth
// are unit-proven in Task 7; this harness does NOT stand up Fastify/JWKS. Instead `postPull` is an
// IN-PROCESS function that runs the SAME window-read + dedup-to-latest + live-body-fetch +
// deleted-since-downgrade + published-form-gate logic as the `POST /api/sync/pull` handler in
// apps/server/src/sync-routes.ts (kept faithful to it — that route is the source of truth; see
// inProcessPull below). This isolates and proves the data round-trip.
//
// Topology (two logical instances, one internal DB each):
//   - openldr_s2_central : central internal DB (authors config; owns reference_change_log)
//   - openldr_s2_lab     : lab internal DB (mirrors central; tracks the 'sync-pull' cursor)
// Reference data is independent (a dashboard/report/form/setting have no FK graph, unlike S1's FHIR),
// so bodies are minimal-but-valid and no read model is needed.
//
// Each DB is dropped-if-exists then created fresh and migrated to latest, so the run is repeatable; a
// finally block drops both.
//
// Preconditions: dev Postgres up on :5433 with the maintenance `openldr` DB.
//   docker compose up -d postgres
//
// Run: pnpm sync:pull:accept
//
// Env override:
//   ADMIN_DATABASE_URL (postgres://openldr:openldr@localhost:5433/openldr) — maintenance DB used to
//   CREATE/DROP the two test databases.
import { type Kysely, sql } from 'kysely';
import {
  createInternalDb,
  createMigrator,
  internalMigrations,
  createReportStore,
  createAppSettingsStore,
  createReferenceApplier,
  referenceCapture,
  readCursor,
  advanceCursor,
  type ReportRecord,
} from '@openldr/db';
import { createDashboardStore } from '@openldr/dashboards';
import { createFormStore, formSyncBody, type FormRow } from '@openldr/forms';
import { createSyncPullRunner, type PullRequest, type PullResponse, type PullRecord } from '@openldr/sync';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr';
const urlFor = (dbName: string): string => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
};

const CENTRAL_DB = 'openldr_s2_central';
const LAB_DB = 'openldr_s2_lab';

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

const RUN_TAG = `s2-accept-${Date.now()}`;
const dashId = `${RUN_TAG}-dash`;
const reportId = `${RUN_TAG}-report`;
const settingKey = 'dashboard.raw_sql'; // the sole CENTER_OWNED_SETTING_KEYS entry
const labLocalDashId = `${RUN_TAG}-lab-local-dash`;

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

// A minimal valid dashboard body (matches the DashboardSchema defaults; the applier reads
// name/filters/widgets/layout + owner/refresh/isDefault).
function dashboardBody(name: string) {
  return {
    id: dashId,
    ownerId: null,
    name,
    layout: [] as unknown[],
    widgets: [] as unknown[],
    filters: [] as unknown[],
    refreshIntervalSec: 0,
    isDefault: false,
  };
}

// A minimal valid report record. designId/primaryQueryId can be any string for this data round-trip.
function reportBody(): ReportRecord {
  return {
    id: reportId,
    name: 'S2 Round-trip Report',
    description: 'reference-data pull acceptance',
    category: 'sync',
    designId: 'design-s2',
    primaryQueryId: 'q-s2',
    summaryMetrics: null,
    chart: null,
    paramOptions: null,
    status: 'published',
  };
}

// A minimal valid form schema (mirrors the shape used by forms/src/store.test.ts).
function formSchema(name: string) {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 's2-intake',
    name,
    versionLabel: null,
    fhirVersion: 'R4',
    fhirResourceType: 'Questionnaire',
    fhirProfileUrl: null,
    facilityId: null,
    status: 'draft',
    active: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
    targetPages: ['forms'],
    languages: ['en'],
    sections: [{ id: 'main', label: 'Main', order: 0 }],
    fields: [
      {
        id: 'q1', fhirPath: null, displayLabel: 'Question 1', description: null,
        fieldType: 'text', required: false, enabled: true, order: 0,
        cardinality: { min: 0, max: '1' }, section: 'main',
      },
    ],
  } as never;
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

    // ── Central stores WITH capture (each write appends a reference_change_log row) ──
    const dashboardStore = createDashboardStore(centralDb, referenceCapture);
    const reportStore = createReportStore(centralDb, referenceCapture);
    const appSettings = createAppSettingsStore(centralDb, referenceCapture);
    const formStore = createFormStore(centralDb, referenceCapture);

    // ── In-process pull endpoint (the flagged S2 shortcut). Faithful to sync-routes.ts POST
    //    /api/sync/pull: window read seq>fromSeq (ordered, capped), nextSeq = max RAW seq, dedup to
    //    the LATEST row per (entity_type, entity_id), fetch the LIVE body (delete → tombstone; body==
    //    null → downgrade to delete; form gated to status='published'). That route is the source of
    //    truth — this replicates it so they don't drift. ──
    async function fetchReferenceBody(entityType: PullRecord['entityType'], id: string): Promise<unknown | null> {
      switch (entityType) {
        case 'dashboard':
          return (await dashboardStore.get(id)) ?? null;
        case 'report':
          return (await reportStore.get(id)) ?? null;
        case 'form': {
          const row = (await centralDb
            .selectFrom('form_definitions')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst()) as FormRow | undefined;
          // Labs may ONLY consume PUBLISHED forms (T7 published-only gate). A non-published/missing
          // live row → null → the handler downgrades it to a delete.
          if (!row || row.status !== 'published') return null;
          return formSyncBody(row);
        }
        case 'setting':
          return (await appSettings.get(id))?.value ?? null;
        default:
          return null;
      }
    }

    async function inProcessPull(req: PullRequest): Promise<PullResponse> {
      const rawFrom = req?.fromSeq;
      const fromSeq = typeof rawFrom === 'number' && Number.isFinite(rawFrom) ? rawFrom : 0;
      const BATCH = 500;
      const rows = await centralDb
        .selectFrom('reference_change_log')
        .selectAll()
        .where('seq', '>', fromSeq)
        .orderBy('seq', 'asc')
        .limit(BATCH)
        .execute();
      const nextSeq = rows.reduce((m, r) => Math.max(m, Number(r.seq)), fromSeq);

      const latest = new Map<string, (typeof rows)[number]>();
      for (const r of rows) latest.set(`${r.entity_type} ${r.entity_id}`, r); // later seq overwrites (asc)

      const records: PullRecord[] = [];
      for (const r of latest.values()) {
        const entityType = r.entity_type as PullRecord['entityType'];
        const seq = Number(r.seq);
        if (r.op === 'delete') {
          records.push({ seq, entityType, entityId: r.entity_id, op: 'delete' });
          continue;
        }
        let body: unknown | null;
        try {
          body = await fetchReferenceBody(entityType, r.entity_id);
        } catch (e) {
          logger.warn(
            { error: e instanceof Error ? e.message : String(e), entityType, entityId: r.entity_id, seq },
            'inProcessPull: fetchReferenceBody failed, skipping',
          );
          continue;
        }
        if (body == null) {
          records.push({ seq, entityType, entityId: r.entity_id, op: 'delete' });
          continue;
        }
        records.push({ seq, entityType, entityId: r.entity_id, op: 'upsert', contentHash: r.content_hash, body });
      }
      records.sort((a, b) => a.seq - b.seq);
      return { records, nextSeq };
    }

    // ── Lab-side pull runner deps (in-process transport; auth/HTTP unit-proven in T7) ──
    const applyRecord = createReferenceApplier(labDb);
    const runner = createSyncPullRunner({
      applyRecord: (rec) => applyRecord(rec),
      postPull: (req) => inProcessPull(req),
      getToken: async () => 'dummy-token', // no HTTP/JWKS in this harness (flagged shortcut)
      readCursor: () => readCursor(labDb, 'sync-pull'),
      advanceCursor: (seq) => advanceCursor(labDb, 'sync-pull', seq),
      logger,
    });

    const labCursor = () => readCursor(labDb, 'sync-pull');
    const refLogCount = async (db: Kysely<never>): Promise<number> => {
      const r = await (db as unknown as typeof centralDb)
        .selectFrom('reference_change_log').select((eb) => eb.fn.countAll().as('n')).executeTakeFirst();
      return r?.n != null ? Number(r.n) : -1;
    };

    // Drain: run cycles until the cursor stops advancing AND nothing is applied (max-iter capped so a
    // bug cannot infinite-loop). Returns total applied + cycle count.
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
        await sleep(10);
      }
      return { cycles, applied };
    }

    // ── 1. Central authors reference config (each write emits a reference_change_log row) ──
    step('1. central authors dashboard + report + published form + center-owned setting');
    await dashboardStore.create(dashboardBody('S2 Round-trip Dashboard'));
    await reportStore.create(reportBody());
    const createdForm = await formStore.create({
      name: 'S2 Intake',
      versionLabel: 'v1',
      fhirResourceType: 'Questionnaire',
      fhirVersion: 'R4',
      schema: formSchema('S2 Intake'),
      targetPages: ['forms'],
    });
    const formId = createdForm.id;
    await formStore.publish(formId); // status='published' so the T7 gate serves it as an upsert
    await appSettings.set(settingKey, 'true', 'admin');
    ok(`authored dashboard=${dashId}, report=${reportId}, form=${formId} (published), setting['${settingKey}']='true'`);

    // Assert central captured at least one upsert per entity (form may be >1 row: create-as-draft is
    // NOT captured, but publish IS; the endpoint dedups per entity anyway).
    const cenLog = await centralDb
      .selectFrom('reference_change_log')
      .select(['entity_type', 'entity_id', 'op'])
      .execute();
    const upsertsFor = (type: string, id: string) =>
      cenLog.filter((r) => r.entity_type === type && r.entity_id === id && r.op === 'upsert').length;
    assert(upsertsFor('dashboard', dashId) >= 1, `central reference_change_log has a dashboard upsert (${upsertsFor('dashboard', dashId)})`);
    assert(upsertsFor('report', reportId) >= 1, `central reference_change_log has a report upsert (${upsertsFor('report', reportId)})`);
    assert(upsertsFor('form', formId) >= 1, `central reference_change_log has a form upsert (${upsertsFor('form', formId)})`);
    assert(upsertsFor('setting', settingKey) >= 1, `central reference_change_log has a setting upsert (${upsertsFor('setting', settingKey)})`);
    const distinctEntities = new Set(cenLog.map((r) => `${r.entity_type} ${r.entity_id}`));
    assert(distinctEntities.size === 4, `central logged exactly 4 distinct entities (got ${distinctEntities.size})`);

    // ── 2. Lab pre-seeds a lab-local dashboard (managed_origin NULL) — pull must NEVER touch it ──
    step('2. lab pre-seeds a lab-local dashboard (managed_origin NULL)');
    await labDb
      .insertInto('dashboards')
      .values({
        id: labLocalDashId,
        owner_id: null,
        name: 'Lab-local Dashboard',
        layout: JSON.stringify([]),
        widgets: JSON.stringify([]),
        filters: JSON.stringify([]),
        refresh_interval_sec: 0,
        is_default: false,
        managed_origin: null,
      } as never)
      .execute();
    ok(`inserted lab-local dashboard ${labLocalDashId} (managed_origin NULL)`);

    // ── 3. Pull drain #1: replicate central → lab ──
    step('3. pull drain #1: replicate central → lab');
    const d1 = await drain();
    ok(`drain #1: ${d1.cycles} cycle(s), ${d1.applied} record(s) applied by lab`);
    assert(d1.applied === 4, `lab applied all 4 reference entities (got ${d1.applied})`);
    const centralMaxSeq = Number((await centralDb.selectFrom('reference_change_log').select((eb) => eb.fn.max('seq').as('m')).executeTakeFirst())?.m ?? 0);
    assert((await labCursor()) === centralMaxSeq, `lab 'sync-pull' cursor reached central max seq (${await labCursor()} === ${centralMaxSeq})`);

    // ── Assertion (a): lab has all 4 entities; the 3 table rows stamped managed_origin='central' ──
    step('4. assert (a) lab mirrors all 4 central entities, stamped managed_origin=central');
    const labDash = await labDb.selectFrom('dashboards').selectAll().where('id', '=', dashId).executeTakeFirst();
    const labReport = await labDb.selectFrom('reports').selectAll().where('id', '=', reportId).executeTakeFirst();
    const labForm = await labDb.selectFrom('form_definitions').selectAll().where('id', '=', formId).executeTakeFirst();
    const labSetting = await labDb.selectFrom('app_settings').selectAll().where('key', '=', settingKey).executeTakeFirst();
    assert(!!labDash, `lab dashboards has ${dashId}`);
    assert(!!labReport, `lab reports has ${reportId}`);
    assert(!!labForm, `lab form_definitions has ${formId}`);
    assert(!!labSetting && labSetting.value === 'true', `lab app_settings['${settingKey}']='true' (got ${labSetting?.value})`);
    assert((labDash as { managed_origin?: string } | undefined)?.managed_origin === 'central', `lab dashboard stamped managed_origin=central`);
    assert((labReport as { managed_origin?: string } | undefined)?.managed_origin === 'central', `lab report stamped managed_origin=central`);
    assert((labForm as { managed_origin?: string } | undefined)?.managed_origin === 'central', `lab form stamped managed_origin=central`);
    assert((labForm as { status?: string } | undefined)?.status === 'published', `lab form arrived as published (upsert, NOT a delete)`);
    pass('(a) all 4 mirrored, 3 table rows stamped central');

    // ── Assertion (b): the lab-local dashboard is UNTOUCHED (present, managed_origin NULL) ──
    step('5. assert (b) lab-local dashboard untouched');
    const labLocal = await labDb.selectFrom('dashboards').selectAll().where('id', '=', labLocalDashId).executeTakeFirst();
    assert(!!labLocal, `lab-local dashboard ${labLocalDashId} still present`);
    assert((labLocal as { managed_origin?: string | null } | undefined)?.managed_origin == null, `lab-local dashboard managed_origin still NULL`);
    pass('(b) lab-local row untouched by pull');

    // ── Assertion (c): edit on central propagates ──
    step('6. assert (c) central edit → lab reflects the new name');
    const editedName = 'S2 Round-trip Dashboard (EDITED)';
    await dashboardStore.update(dashId, dashboardBody(editedName));
    const dEdit = await drain();
    ok(`edit drain: ${dEdit.cycles} cycle(s), ${dEdit.applied} applied`);
    const labDashEdited = await labDb.selectFrom('dashboards').selectAll().where('id', '=', dashId).executeTakeFirst();
    assert((labDashEdited as { name?: string } | undefined)?.name === editedName, `lab dashboard name updated to '${editedName}' (got '${(labDashEdited as { name?: string } | undefined)?.name}')`);
    pass('(c) edit propagated');

    // ── Assertion (d): delete + the managed_origin delete guard ──
    step('7. assert (d) central delete removes central-managed lab row; lab-local reuse survives (guard)');
    await reportStore.remove(reportId);
    const dDel = await drain();
    ok(`delete drain: ${dDel.cycles} cycle(s), ${dDel.applied} applied`);
    const labReportGone = await labDb.selectFrom('reports').selectAll().where('id', '=', reportId).executeTakeFirst();
    assert(!labReportGone, `central-managed lab report ${reportId} is GONE after delete`);

    // Insert a lab-local reports row that REUSES the deleted id (managed_origin NULL).
    await labDb
      .insertInto('reports')
      .values({
        id: reportId,
        name: 'Lab-local Report (reused id)',
        description: '',
        category: 'local',
        design_id: 'd', primary_query_id: 'q',
        summary_metrics: null, chart: null, param_options: null,
        status: 'draft',
        managed_origin: null,
      } as never)
      .execute();
    // A subsequent drain has no new central changes → the lab-local row is not touched.
    const dDel2 = await drain();
    ok(`post-reuse drain: ${dDel2.cycles} cycle(s), ${dDel2.applied} applied`);
    const labLocalReport = await labDb.selectFrom('reports').selectAll().where('id', '=', reportId).executeTakeFirst();
    assert(!!labLocalReport, `lab-local reports row reusing id ${reportId} SURVIVES a no-op drain`);

    // Directly exercise the guard: replay the SAME delete record against the lab (the drain won't
    // re-serve it — the cursor already advanced past it). The applier's delete is scoped to
    // managed_origin='central', so a lab-local (NULL) row must NOT be removed.
    await applyRecord({ entityType: 'report', entityId: reportId, op: 'delete' });
    const labLocalAfterGuard = await labDb.selectFrom('reports').selectAll().where('id', '=', reportId).executeTakeFirst();
    assert(!!labLocalAfterGuard, `direct replay of the central delete does NOT remove the lab-local row (managed_origin guard)`);
    assert((labLocalAfterGuard as { managed_origin?: string | null } | undefined)?.managed_origin == null, `surviving row is still the lab-local one (managed_origin NULL)`);
    pass('(d) delete removes central-managed row; managed_origin guard protects lab-local reuse');

    // ── Assertion (e): re-seed unchanged emits no new reference_change_log row (content-hash dedup) ──
    step('8. assert (e) re-authoring identical dashboard content emits NO new reference_change_log row');
    const logBefore = await refLogCount(centralDb as unknown as Kysely<never>);
    await dashboardStore.update(dashId, dashboardBody(editedName)); // identical to the current (edited) body
    const logAfter = await refLogCount(centralDb as unknown as Kysely<never>);
    assert(logAfter === logBefore, `no new reference_change_log row for an unchanged re-author (${logAfter} === ${logBefore})`);
    pass('(e) content-hash dedup: unchanged re-author is a no-op');

    // ── Assertion (f): idempotent drain with no new changes → 0 applied, cursor unchanged ──
    step('9. assert (f) final drain is idempotent: 0 applied, cursor unchanged');
    const cursorBefore = await labCursor();
    const cyc = await runner.runCycle();
    const cursorAfter = await labCursor();
    assert(cyc === 0, `final runCycle applied 0 records (got ${cyc})`);
    assert(cursorAfter === cursorBefore, `lab 'sync-pull' cursor unchanged (${cursorAfter} === ${cursorBefore})`);
    pass('(f) idempotent: no re-apply, no cursor drift');
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
    console.log('\n✅ sync:pull:accept PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ sync:pull:accept FAILED');
    process.exit(1);
  }
}

void main();
