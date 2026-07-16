// Two-Postgres integration proof for Distributed Sync S7 — SAME-VERSION DIVERGENCE detection.
//
// The bug this proves closed: applyRemote's idempotency key is (resource_type, id, version). A lab
// result at v1 is pushed up. Central amends it → v2. In the SAME window the lab re-edits locally →
// its save() also mints v2, with DIFFERENT content. Under the old `if (already) return 'skipped'`
// both sides then silently drop the other's edit, both cursors advance, both report healthy, and the
// two databases disagree forever with nothing noticing.
//
// THE PROPERTY THIS HARNESS EXISTS TO PROVE — THE SYMMETRY: one divergence produces a row on BOTH
// sides INDEPENDENTLY, each holding the body ITS OWN machine dropped, each keeping its own copy
// canonical. That symmetry is exactly why the slice needs no wire-protocol change: neither side has
// to tell the other anything. If this harness did not prove the symmetry it would not have proven
// the design.
//
// This is a REAL-Postgres harness (not pg-mem): the divergence row is written inside applyRemote's
// OWN transaction, the (resource_type, resource_id, version) conflict key drives the idempotent
// re-detection, `version` is a real bigint (reads back as a STRING — always Number()-coerce), and
// incoming_body round-trips through real jsonb. It mirrors scripts/sync-amend-live-acceptance.ts
// (the S6a reference AMENDMENT harness) and reuses its scaffolding verbatim: create fresh DBs on
// :5433, migrate to latest, construct createInternalDb + createFhirStore handles, drive the REAL
// serve + runner path, assert against fhir.* + sync_divergences, drop the DBs in a finally.
//
// DELIBERATE SHORTCUT (inherited from S6a, flagged): the central pull-amendments endpoint's
// HTTP/JWKS transport + client-credentials auth + site-scoping principal are unit-proven; this
// harness does NOT stand up Fastify/JWKS. The pull runner's `postPull` calls serveAmendments(
// centralCtx, SITE, fromSeq) IN-PROCESS — the SAME serve logic the POST /api/sync/pull-amendments
// route calls — with a minimal ctx stub. The drain is otherwise the REAL runner + REAL applyRemote.
//
// Topology (two logical instances, one internal DB each):
//   - openldr_s7div_central : central internal DB (mirrors the lab result; authors the amendment;
//                             receives the lab's colliding v2 push → records ITS divergence)
//   - openldr_s7div_lab     : lab internal DB (owns the result; re-edits to its OWN v2; drains
//                             central's amendment down → records ITS divergence)
//
// Each DB is dropped-if-exists then created fresh and migrated to latest, so the run is repeatable;
// a finally block drops both.
//
// Preconditions: dev Postgres up on :5433 with the maintenance `openldr` DB.
//   docker compose up -d postgres
//
// Run: pnpm sync:divergence:accept
//
// Env override:
//   ADMIN_DATABASE_URL (postgres://openldr:openldr@localhost:5433/openldr) — maintenance DB used to
//   CREATE/DROP the two test databases.
import { type Kysely, sql } from 'kysely';
import {
  createInternalDb,
  createFhirStore,
  createMigrator,
  createSyncDivergenceStore,
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

const CENTRAL_DB = 'openldr_s7div_central';
const LAB_DB = 'openldr_s7div_lab';
const SITE = 'lab-a';

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
const pass = (m: string) => console.log(`PASS: ${m}`);

const RUN_TAG = `s7div-accept-${Date.now()}`;
const obsId = `${RUN_TAG}-obs`;
const controlId = `${RUN_TAG}-control`;

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

// The preliminary lab Observation (the pre-divergence body, v1 on BOTH sides).
function preliminaryObservation(): FhirResource {
  return {
    resourceType: 'Observation',
    id: obsId,
    status: 'preliminary',
    code: { coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] },
    subject: { reference: 'Patient/s7div-pat' },
    valueQuantity: { value: 13.5, unit: 'g/dL' },
    effectiveDateTime: '2026-05-02T00:00:00Z',
  } as unknown as FhirResource;
}

// A never-diverging control: applied then re-applied identically must stay 'applied' → 'skipped'.
function controlObservation(): FhirResource {
  return {
    resourceType: 'Observation',
    id: controlId,
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '4544-3', display: 'Hematocrit' }] },
    subject: { reference: 'Patient/s7div-pat' },
    valueQuantity: { value: 41, unit: '%' },
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
    const centralDiv = createSyncDivergenceStore(centralDb);
    const labDiv = createSyncDivergenceStore(labDb);

    // ── 1. A lab authors a preliminary Observation, mirrored UP to central (simulate the S1 push with
    //    applyRemote at origin version 1 + the lab's site_id). Both change_log rows carry site_id=SITE,
    //    which is what makes central's amend() recognise the resource as lab-owned. ──
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

    // ── 2. Central amends the lab-owned Observation → central's v2 ──
    step('2. central amends the lab-owned Observation → central mints v2 (status=amended)');
    const amendResult = await centralStore.amend({
      resourceType: 'Observation',
      id: obsId,
      status: 'amended',
      agent: 'acceptance',
      reason: 'central validation',
    });
    ok(`amend → version=${amendResult.version}, provenanceId=${amendResult.provenanceId}, siteId=${amendResult.siteId}`);
    assert(amendResult.version === 2, `central amendment is version 2 (got ${amendResult.version})`);

    // ── 3. THE RACE: the lab re-edits LOCALLY before the amendment arrives, so its save() independently
    //    mints v2 too — the SAME version number carrying DIFFERENT content. This is the whole premise:
    //    if the lab does not independently reach v2 there is no collision and every assertion below is
    //    vacuous, so this is asserted LOUDLY. ──
    step('3. THE RACE: lab re-edits locally before the amendment arrives → lab independently mints v2');
    const labSaved = await labStore.save({
      ...(preliminaryObservation() as unknown as Record<string, unknown>),
      status: 'corrected',
      valueQuantity: { value: 12.1, unit: 'g/dL' },
    } as unknown as FhirResource);
    ok(`lab save() → version=${labSaved.version}`);
    const labV2 = await labDb
      .selectFrom('fhir.fhir_resources')
      .select(['version', 'resource'])
      .where('resource_type', '=', 'Observation')
      .where('id', '=', obsId)
      .executeTakeFirst();
    assert(
      Number(labV2?.version) === 2,
      `RACE IS SET UP: lab independently minted v2 with its own content (got version ${labV2?.version}) ` +
        `— if this fails the collision never happens and the whole harness is vacuous`,
    );
    // jsonb reads back parsed on node-pg but as text on some drivers — normalize both.
    const labV2Body = (typeof labV2?.resource === 'string'
      ? JSON.parse(labV2.resource)
      : labV2?.resource) as Record<string, unknown>;
    assert(labV2Body?.status === 'corrected', `lab's own v2 body is 'corrected' (got '${labV2Body?.status}')`);

    // ── 4. The lab pushes its colliding v2 UP. Central already holds a v2 (its amendment) at the same
    //    key with different content → 'diverged': central KEEPS its amendment and durably records the
    //    LAB's dropped body. ──
    step("4. lab pushes its v2 up → central detects divergence, keeps its amendment, records the LAB's dropped body");
    const pushRecord = {
      resourceType: 'Observation' as const,
      id: obsId,
      version: 2,
      op: 'upsert' as const,
      siteId: SITE,
      resource: labV2Body as unknown as FhirResource,
    };
    const pushResult = await centralStore.applyRemote(pushRecord);
    assert(pushResult === 'diverged', `central applyRemote of the lab's colliding v2 returns 'diverged' (got '${pushResult}')`);

    const cenRows = await centralDiv.list();
    assert(cenRows.length === 1, `central has exactly ONE divergence row (got ${cenRows.length})`);
    const cenRow = await centralDiv.get('Observation', obsId, 2);
    assert(!!cenRow, `central divergence row is readable at (Observation, ${obsId}, 2)`);
    assert(
      (cenRow?.incomingBody as { status?: string } | null)?.status === 'corrected',
      `central's row holds the LAB's dropped body (status 'corrected', got '${(cenRow?.incomingBody as { status?: string } | null)?.status}')`,
    );
    const cenCanonical = (await centralStore.get('Observation', obsId)) as Record<string, unknown> | null;
    assert(
      cenCanonical?.status === 'amended',
      `central KEPT its own amendment as canonical (status 'amended', got '${cenCanonical?.status}')`,
    );
    pass("central: divergence recorded, lab's edit preserved as evidence, central's amendment kept");

    // ── 5. The lab drains its amendment stream through the REAL serve + runner path. Central's
    //    amendment lands on a version the lab already minted itself → the lab ALSO diverges, keeping
    //    its own edit and recording CENTRAL's dropped body. ──
    step("5. lab drains central's amendment (REAL serveAmendments → REAL runner → REAL applyRemote)");
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
    ok(
      `drain cycle #1 → outcome '${cycle1.outcome}', applied ${cycle1.applied} ` +
        `(diverged records are EXCLUDED from applied by design); cursor now ${amendCursor}`,
    );
    // The S7 contract this slice rests on: a window carrying a divergence still reports 'progressed',
    // because the WINDOW was processed and the cursor advanced — never because `applied` is non-zero.
    // This harness is the live proof of that claim, so assert it rather than only logging it.
    assert(cycle1.outcome === 'progressed', `drain cycle #1 reports outcome 'progressed' despite the divergence (got '${cycle1.outcome}')`);

    const labRows = await labDiv.list();
    assert(labRows.length === 1, `lab has exactly ONE divergence row (got ${labRows.length})`);
    const labRow = await labDiv.get('Observation', obsId, 2);
    assert(!!labRow, `lab divergence row is readable at (Observation, ${obsId}, 2)`);
    assert(
      (labRow?.incomingBody as { status?: string } | null)?.status === 'amended',
      `lab's row holds CENTRAL's dropped body (status 'amended', got '${(labRow?.incomingBody as { status?: string } | null)?.status}')`,
    );
    const labCanonical = (await labStore.get('Observation', obsId)) as Record<string, unknown> | null;
    assert(
      labCanonical?.status === 'corrected',
      `lab KEPT its own edit as canonical (status 'corrected', got '${labCanonical?.status}')`,
    );
    pass("lab: divergence recorded, central's amendment preserved as evidence, lab's edit kept");

    // ── 6. THE SYMMETRY — the property the whole design rests on. ONE divergence, TWO independent
    //    rows, each side holding what IT dropped, neither side having told the other anything. ──
    step('6. THE SYMMETRY: both sides independently recorded the divergence, each holding what IT dropped');
    assert(
      cenRow!.localHash !== cenRow!.incomingHash,
      `central's row records genuinely different content (localHash !== incomingHash)`,
    );
    assert(
      labRow!.localHash !== labRow!.incomingHash,
      `lab's row records genuinely different content (localHash !== incomingHash)`,
    );
    // The two sides' KEPT bodies differ, and each side's DROPPED body is the other's KEPT body: the
    // hashes cross over. This is the symmetry stated in hashes rather than in status strings.
    assert(
      cenRow!.localHash === labRow!.incomingHash,
      `central's KEPT body is exactly what the lab DROPPED (central.localHash === lab.incomingHash)`,
    );
    assert(
      labRow!.localHash === cenRow!.incomingHash,
      `lab's KEPT body is exactly what central DROPPED (lab.localHash === central.incomingHash)`,
    );
    assert(
      cenRow!.incomingSiteId === SITE,
      `central's row attributes the dropped edit to site '${SITE}' (got '${cenRow!.incomingSiteId}')`,
    );
    pass('SYMMETRY: one divergence → two independent rows, each holding the body its own machine dropped');

    // ── 7. Idempotent re-detection: a re-delivered diverged record must neither duplicate the row nor
    //    churn detected_at (a stuck redelivery loop must not be able to inflate the table). ──
    step('7. idempotent re-detection: re-push + re-drain leave one row per side, detectedAt unchanged');
    const cenDetectedAt = cenRow!.detectedAt.getTime();
    const labDetectedAt = labRow!.detectedAt.getTime();

    const rePush = await centralStore.applyRemote(pushRecord);
    assert(rePush === 'diverged', `re-pushed colliding v2 still returns 'diverged' (got '${rePush}')`);
    amendCursor = 0; // rewind the cursor so the runner re-serves + re-applies the same amendment window
    const cycle2 = await runner.runCycle();
    ok(
      `drain cycle #2 (cursor rewound to 0) → outcome '${cycle2.outcome}', applied ${cycle2.applied} ` +
        `(diverged records are EXCLUDED from applied by design)`,
    );
    // Re-delivering the same diverged window still processes it and advances the cursor → 'progressed'.
    assert(cycle2.outcome === 'progressed', `drain cycle #2 reports outcome 'progressed' on re-delivery (got '${cycle2.outcome}')`);

    const cenRows2 = await centralDiv.list();
    const labRows2 = await labDiv.list();
    assert(cenRows2.length === 1, `central still has exactly ONE divergence row after re-push (got ${cenRows2.length})`);
    assert(labRows2.length === 1, `lab still has exactly ONE divergence row after re-drain (got ${labRows2.length})`);
    const cenRow2 = await centralDiv.get('Observation', obsId, 2);
    const labRow2 = await labDiv.get('Observation', obsId, 2);
    assert(
      cenRow2!.detectedAt.getTime() === cenDetectedAt,
      `central's detectedAt is unchanged — the FIRST detection is the fact kept (${cenRow2!.detectedAt.toISOString()})`,
    );
    assert(
      labRow2!.detectedAt.getTime() === labDetectedAt,
      `lab's detectedAt is unchanged — the FIRST detection is the fact kept (${labRow2!.detectedAt.toISOString()})`,
    );
    pass('idempotent: re-delivery neither duplicates the row nor churns detectedAt');

    // ── 8. The control: a resource that never diverged must record NOTHING. This is what stops the
    //    detection from firing on every ordinary re-drain. ──
    step("8. control: a resource that never diverged records nothing ('applied' → 'skipped', NOT 'diverged')");
    const controlRecord = {
      resourceType: 'Observation' as const,
      id: controlId,
      version: 1,
      op: 'upsert' as const,
      siteId: SITE,
      resource: controlObservation(),
    };
    const ctl1 = await centralStore.applyRemote(controlRecord);
    const ctl2 = await centralStore.applyRemote(controlRecord);
    assert(ctl1 === 'applied', `control record first apply is 'applied' (got '${ctl1}')`);
    assert(ctl2 === 'skipped', `control record identical re-apply is 'skipped', NOT 'diverged' (got '${ctl2}')`);
    const cenRows3 = await centralDiv.list();
    assert(cenRows3.length === 1, `no divergence row recorded for the control resource (central still has 1, got ${cenRows3.length})`);
    assert(
      !(await centralDiv.get('Observation', controlId, 1)),
      `no divergence row exists at (Observation, ${controlId}, 1)`,
    );
    pass('control: an ordinary idempotent re-drain records nothing');

    // ── 9. Clear closes it — and ONLY on the side that cleared. The two rows are independent facts on
    //    independent machines; resolving one must not touch the other. ──
    step("9. clear closes the lab's row and leaves central's untouched (the rows are independent facts)");
    await labDiv.clear('Observation', obsId, 2);
    assert(
      !(await labDiv.get('Observation', obsId, 2)),
      `lab's divergence row is gone after clear()`,
    );
    assert((await labDiv.list()).length === 0, `lab's divergence list is now empty`);
    const cenAfterClear = await centralDiv.get('Observation', obsId, 2);
    assert(!!cenAfterClear, `central's divergence row is UNTOUCHED by the lab's clear()`);
    assert(
      cenAfterClear!.detectedAt.getTime() === cenDetectedAt,
      `central's row is byte-for-byte the same fact (detectedAt unchanged)`,
    );
    pass("clear: resolves one side only — the other side's row survives");
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
    console.log('\n✅ sync:divergence:accept PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ sync:divergence:accept FAILED');
    process.exit(1);
  }
}

void main();
