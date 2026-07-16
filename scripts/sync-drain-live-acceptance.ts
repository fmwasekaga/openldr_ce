// Two-Postgres integration proof for Distributed Sync S7 — the CATCH-UP DRAIN (S7 drain/wakeup
// Task 6). It proves the one claim the whole slice rests on:
//
//   ONE tick drains a backlog LARGER than the 500-record batch ceiling.
//
// Pre-S7 that was structurally impossible. A tick ran exactly ONE runCycle() = one <=500-record
// batch, on a 15-minute default interval (~2,000 records/hour), so 1,200 records needed THREE ticks
// (~45 minutes) and a 100k first-enrollment backlog took ~50 hours. The host loop now drains until
// the runner reports 'drained'/'failed', bounded by a time budget of floor(intervalMs / 2).
//
// WHY A LIVE HARNESS AND NOT ANOTHER UNIT TEST: this repo has been burned twice by exactly the shape
// of test that cannot see the failure it is supposed to guard. S7-B's compress plugin shipped INERT
// while its unit test built its own Fastify in the one registration order that works; a bare
// reply.send() returned an EMPTY body while all 65 server unit tests stayed green. So this harness
// deliberately does NOT construct its own worker: it builds the SHIPPED createSyncPushWorker — the
// exact wrapper packages/bootstrap/src/index.ts wires into the host — and drives its tickOnce().
// A harness that assembles a replica proves nothing about the thing that ships.
//
// FALSIFIABILITY (the property that makes this harness worth having): reverting drain-worker.ts's
// `for (;;) { ... }` loop to a single `await opts.runner.runCycle()` MUST make step 3 fail with
// "central holds all 1200 after ONE tick (got 500)". It does. The harness proves the gap, not just
// the fix.
//
// DELIBERATE SHORTCUT (inherited + flagged, same as scripts/sync-live-acceptance.ts): the central
// endpoint's HTTP/JWKS transport + client-credentials auth are unit-proven; this harness does NOT
// stand up Fastify/JWKS. `postPush` is an IN-PROCESS function applying to the central store directly
// with a stub site principal. What is under test here is the HOST LOOP's cadence, not the transport.
//
// Topology (no external/read-model DB — this slice asserts on fhir.* only, so central needs no
// canonical projection target):
//   - openldr_s7drain_lab     : lab internal DB (fhir.* + change_log, site-stamped)
//   - openldr_s7drain_central : central internal DB (fhir.* mirror target)
//
// Each DB is dropped-if-exists then created fresh and migrated to latest, so the run is repeatable;
// a finally block drops both.
//
// Preconditions: dev Postgres up on :5433 with the maintenance `openldr` DB.
//   docker compose up -d postgres
//
// Run: pnpm sync:drain:accept
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
  fetchSafeChangeRows,
  readCursor,
  advanceCursor,
} from '@openldr/db';
import { createSyncPushRunner, type PushBatch, type PushResponse, type SyncRecord } from '@openldr/sync';
import type { FhirResource } from '@openldr/fhir';
// Deep relative import ON PURPOSE. createSyncPushWorker is not re-exported from @openldr/bootstrap's
// index (the host imports it internally, from './sync-push-worker'), and widening that public surface
// just to test it would be the tail wagging the dog. This resolves to the IDENTICAL module the host
// loads — which is the entire point of this harness. Do not swap it for a locally-built worker.
import { createSyncPushWorker } from '../packages/bootstrap/src/sync-push-worker';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr';
const urlFor = (dbName: string): string => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
};

const LAB_DB = 'openldr_s7drain_lab';
const CENTRAL_DB = 'openldr_s7drain_central';
const LAB_SITE = 'site-lab-1';

// The backlog. Larger than the runner's 500-record batch ceiling, so draining it in ONE tick REQUIRES
// the loop (1200 -> 3 pushed batches + 1 empty confirming cycle). Kept at the SHIPPED batchSize of 500:
// shrinking the batch would make the harness pass with or without the drain loop, i.e. prove nothing.
const N = 1200;
const BATCH_SIZE = 500;

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
const pass = (m: string) => console.log(`PASS: ${m}`);

// Surface real apply/cycle failures (they would be findings); stay quiet otherwise.
const logger = {
  info() {},
  warn(o: unknown, m?: string) { console.log('  [sync.warn]', m ?? '', o); },
  debug() {},
  error(o: unknown, m?: string) { console.error('  [sync.error]', m ?? '', o); },
};

const RUN_TAG = `s7drain-accept-${Date.now()}`;

// A flat backlog of standalone Observations: no FK graph is needed (this harness asserts on the
// internal fhir.* mirror, never on the canonical read model), and one resource per change_log row
// keeps the seeded seq count exactly N.
function seedObservation(i: number): FhirResource {
  return {
    resourceType: 'Observation',
    id: `${RUN_TAG}-obs-${String(i).padStart(5, '0')}`,
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] },
    valueQuantity: { value: 10 + (i % 50) / 10, unit: 'g/dL' },
    effectiveDateTime: '2026-05-02T00:00:00Z',
  } as unknown as FhirResource;
}

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
  let worker: ReturnType<typeof createSyncPushWorker> | undefined;

  try {
    step('0. provision + migrate two fresh databases on :5433');
    await provisionDb(adminDb, LAB_DB);
    await provisionDb(adminDb, CENTRAL_DB);
    ok(`created ${LAB_DB}, ${CENTRAL_DB}`);

    lab = createInternalDb(urlFor(LAB_DB));
    central = createInternalDb(urlFor(CENTRAL_DB));
    const labDb = lab.db;
    const centralDb = central.db;

    await migrateInternal(labDb as unknown as Kysely<unknown>);
    await migrateInternal(centralDb as unknown as Kysely<unknown>);
    ok('migrated lab (internal) + central (internal) to latest');

    // Stamp the lab's site BEFORE the fhir store resolves it (resolveSiteId memoizes on first save).
    await labDb
      .insertInto('app_settings')
      .values({ key: 'sync.site_id', value: LAB_SITE })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: LAB_SITE }))
      .execute();
    ok(`lab app_settings 'sync.site_id' = '${LAB_SITE}'`);

    const labStore = createFhirStore(labDb);
    const centralStore = createFhirStore(centralDb);

    // ── In-process central endpoint (the flagged shortcut). Faithful to sync-routes.ts:
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
        const rec = record as SyncRecord & { seq: number };
        if (Number.isFinite(rec.seq)) ackSeq = Math.max(ackSeq, rec.seq);
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

    // Count the batches the host loop actually posts, so the step-3 failure mode is legible: a single
    // -cycle tick posts exactly ONE. REPORTING ONLY — no assertion branches on it.
    let pushedBatches = 0;

    const runner = createSyncPushRunner({
      internalDb: labDb,
      fetchSafeRows: fetchSafeChangeRows,
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
      postPush: (batch) => { pushedBatches++; return inProcessPush(batch, { siteId: LAB_SITE }); },
      getToken: async () => 'dummy-token', // no HTTP/JWKS in this harness (flagged shortcut)
      readCursor: () => readCursor(labDb, 'sync-push'),
      advanceCursor: (seq) => advanceCursor(labDb, 'sync-push', seq),
      logger,
      batchSize: BATCH_SIZE,
    });

    const labCursor = () => readCursor(labDb, 'sync-push');
    const labMaxSeq = async (): Promise<number> => {
      const r = await labDb.selectFrom('fhir.change_log').select((eb) => eb.fn.max('seq').as('m')).executeTakeFirst();
      return r?.m != null ? Number(r.m) : 0; // bigint reads back as a STRING on real pg
    };
    const centralObsCount = async (): Promise<number> => {
      const r = await centralDb
        .selectFrom('fhir.fhir_resources')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('resource_type', '=', 'Observation')
        .executeTakeFirst();
      return r?.n != null ? Number(r.n) : 0;
    };

    // ── 1. Seed a backlog LARGER than the batch ceiling ──
    step(`1. seed lab with ${N} Observations (site ${LAB_SITE}) — ${Math.ceil(N / BATCH_SIZE)}x the ${BATCH_SIZE}-record batch ceiling`);
    const seedStart = Date.now();
    for (let i = 0; i < N; i++) await labStore.save(seedObservation(i));
    ok(`saved ${N} Observations in ${Date.now() - seedStart}ms`);
    const labSeqTarget = await labMaxSeq();
    // Assert the seed really produced the backlog: if save() silently under-produced change_log rows
    // the drain would "succeed" against a backlog that never exceeded the ceiling — a green run
    // proving nothing. Fail loudly here instead.
    assert(labSeqTarget >= N, `lab change_log head advanced past the whole seed (max(seq)=${labSeqTarget} >= ${N})`);
    assert(labSeqTarget > BATCH_SIZE, `backlog (${labSeqTarget}) EXCEEDS the ${BATCH_SIZE}-record batch ceiling — one cycle cannot clear it`);

    // ── 2. ONE tick ──
    // intervalMs 60_000 so the interval timer NEVER fires during this run: every cycle below is one we
    // drove by hand. tickOnce() is the awaitable form of the same drain start()/trigger() fire.
    step('2. build the SHIPPED createSyncPushWorker and drive exactly ONE tick');
    worker = createSyncPushWorker({ runner, intervalMs: 60_000, logger: logger as never });
    ok(`worker built via createSyncPushWorker (the wrapper packages/bootstrap/src/index.ts wires into the host); budgetMs=${worker.budgetMs}`);
    const tickStart = Date.now();
    await worker.tickOnce();
    ok(`ONE tickOnce() completed in ${Date.now() - tickStart}ms; the loop posted ${pushedBatches} batch(es)`);

    // ── 3. THE CLAIM: the entire backlog reached central after that single tick ──
    step('3. assert ONE tick drained the ENTIRE backlog past the batch ceiling');
    const c = await centralObsCount();
    assert(c === N, `central holds all ${N} after ONE tick (got ${c}) — pre-S7 this capped at ${BATCH_SIZE}`);
    pass(`(a) one tick drained ${N} records — ${Math.ceil(N / BATCH_SIZE)} batches, not 1`);

    // ── 4. The drain ran to COMPLETION, not to the budget ──
    step('4. assert the push cursor advanced past the whole backlog');
    const cursorAfter = await labCursor();
    assert(
      cursorAfter >= labSeqTarget,
      `lab 'sync-push' cursor reached the backlog head (${cursorAfter} >= ${labSeqTarget}) — drain ran to completion, not to the budget`,
    );
    pass('(b) cursor at the head');

    // ── 5. A second tick is a clean no-op ──
    step('5. assert a second tick is a clean no-op (drained → stops immediately, no re-push)');
    const countBefore = await centralObsCount();
    const cursorBefore = cursorAfter;
    const batchesBefore = pushedBatches;
    await worker.tickOnce();
    const countAfter = await centralObsCount();
    assert(countAfter === countBefore, `central Observation count unchanged after a second tick (${countAfter} === ${countBefore})`);
    assert((await labCursor()) === cursorBefore, `lab cursor unchanged after a second tick (${await labCursor()} === ${cursorBefore})`);
    assert(pushedBatches === batchesBefore, `second tick posted NO batch (${pushedBatches} === ${batchesBefore}) — 'drained' stops the loop, it does not re-push`);
    pass('(c) caught-up tick is a no-op');
    worker.stop();
    assert(!worker.isRunning(), 'worker.stop() → isRunning() === false');

    // ── 6. The budget genuinely bounds the drain ──
    // createSyncPushWorker deliberately does NOT expose drainBudgetMs (the host has exactly one dial,
    // sync.interval_minutes — see drain-worker.ts:52-54), so the budget is driven the only way an
    // operator can drive it: through intervalMs. Two things are proven, both through the SHIPPED
    // wrapper, neither fabricating an API the product does not have:
    //   (i)  the derived default is floor(intervalMs / 2);
    //   (ii) a runner that NEVER reports 'drained' still terminates — the budget, not the runner,
    //        ends the drain. Without the deadline check this tick would spin forever and the harness
    //        would hang rather than fail, so the assertion is the run completing at all.
    step('6. assert the drain budget bounds a runner that never drains');
    assert(worker.budgetMs === 30_000, `budgetMs is the derived floor(intervalMs / 2) = 30000 for intervalMs=60000 (got ${worker.budgetMs})`);

    let spinCycles = 0;
    const neverDrains = {
      runCycle: async () => {
        spinCycles++;
        await new Promise<void>((r) => setTimeout(r, 10));
        return { outcome: 'progressed' as const, applied: 1 }; // always more to do — only the budget can stop this
      },
    };
    const budgeted = createSyncPushWorker({ runner: neverDrains, intervalMs: 200, logger: logger as never });
    assert(budgeted.budgetMs === 100, `budgeted worker derived budgetMs=100 from intervalMs=200 (got ${budgeted.budgetMs})`);
    const budgetStart = Date.now();
    await budgeted.tickOnce();
    const budgetElapsed = Date.now() - budgetStart;
    budgeted.stop();
    assert(spinCycles > 1, `the always-'progressed' runner DID loop (${spinCycles} cycles) — it is not exiting for some other reason`);
    assert(
      budgetElapsed < 5_000,
      `tickOnce() EXITED on the ${budgeted.budgetMs}ms budget rather than spinning (elapsed ${budgetElapsed}ms, ${spinCycles} cycles)`,
    );
    pass('(d) budget bounds the drain');
  } catch (e) {
    if (failures === 0) failures++;
    console.error('\n[FAIL]', e instanceof Error ? e.stack : e);
  } finally {
    // stop() is idempotent; this backstops an early throw leaving the worker live.
    try { worker?.stop(); } catch { /* ignore */ }
    // Close instance handles BEFORE dropping (DROP DATABASE needs no live sessions; WITH FORCE backstops).
    try { await lab?.close(); } catch { /* ignore */ }
    try { await central?.close(); } catch { /* ignore */ }
    try {
      await provisionDrop(adminDb, LAB_DB);
      await provisionDrop(adminDb, CENTRAL_DB);
    } catch (e) { console.error('  [cleanup] drop failed', e); }
    await admin.close();
  }

  if (failures > 0) throw new Error(`sync:drain:accept FAILED (${failures} failure(s))`);
  pass('sync:drain:accept');
  console.log('\n✅ sync:drain:accept PASSED');
}

void main().catch((e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
