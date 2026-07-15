// Single-Postgres integration proof for Distributed Sync S7-A — the POISON-BULK WEDGE, broken and healed.
//
// Before S7-A, a reproducibly-failing terminology bulk record HELD the ordered 'sync-pull' cursor forever:
// because a bulk apply is all-or-nothing, a failure stopped the window and left the cursor put, so the
// record replayed every cycle — and EVERY reference/config change behind it in seq order was silently
// blocked, indefinitely. That is the wedge.
//
// S7-A keeps the transient-failure semantics (hold + retry) but bounds them: consecutive failures for the
// same entity are counted durably in `sync_quarantine` (migration 055), and once the threshold is crossed
// the runner advances PAST the poison record — the stream unwedges, the blocked config applies, and the
// quarantined entity is surfaced to the operator. When the underlying cause is fixed and the entity
// applies successfully again, `holdSuccess` clears the counter.
//
// This harness proves that end-to-end against REAL Postgres with the REAL `createSyncQuarantineStore` and
// the REAL `createSyncPullRunner`, over the REAL 'sync-pull' row in `fhir.change_cursors`:
//   cycle 1 → held  (cursor 0, setting behind the poison BLOCKED, attempts 1 'holding')
//   cycle 2 → held  (cursor 0, still blocked,                     attempts 2 'holding')
//   cycle 3 → QUARANTINED (attempts 3) → cursor advances to 6 → THE BLOCKED SETTING APPLIES  ← the crux
//   cycle 4 → cause fixed, central re-publishes the system → it applies → holdSuccess CLEARS the row
//
// DELIBERATE SHORTCUT (flagged): unlike the co-edit harnesses this needs no second (central) instance and
// no HTTP — `postPull` serves a fixed, hand-built window IN-PROCESS. The transport is proven elsewhere
// (sync:pull:accept); what is under test here is the runner's hold→quarantine decision + the durable store
// + the real cursor row, all of which are REAL. `applyRecord` deliberately THROWS for the poison record to
// simulate a reproducibly-failing bulk apply, and records the `setting` record it applies so the unwedge
// is directly observable.
//
// Topology: one internal DB.
//   - openldr_s7a_lab : lab internal DB (owns fhir.change_cursors + sync_quarantine)
//
// The DB is dropped-if-exists then created fresh and migrated to latest, so the run is repeatable; a
// finally block drops it.
//
// Preconditions: dev Postgres up on :5433 with the maintenance `openldr` DB.
//   docker compose up -d postgres
//
// Run: pnpm sync:quarantine:accept
//
// Env override:
//   ADMIN_DATABASE_URL (postgres://openldr:openldr@localhost:5433/openldr) — maintenance DB used to
//   CREATE/DROP the test database.
import { type Kysely, sql } from 'kysely';
import {
  createInternalDb,
  createMigrator,
  createSyncQuarantineStore,
  internalMigrations,
  readCursor as readChangeCursor,
  advanceCursor as advanceChangeCursor,
} from '@openldr/db';
import { createSyncPullRunner, type PullRecord, type PullRequest, type PullResponse } from '@openldr/sync';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr';
const urlFor = (dbName: string): string => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
};

const LAB_DB = 'openldr_s7a_lab';

// The poison: a terminology_system (a HOLD record — all-or-nothing bulk) whose apply fails reproducibly.
const POISON_TYPE = 'terminology_system';
const POISON_ID = 'http://poison';
// The victim: a per-row config record sequenced BEHIND the poison. Pre-S7-A it could never apply.
const VICTIM_ID = 'flag.x';
const THRESHOLD = 3; // consecutive bulk-apply failures before quarantine — same constant bootstrap uses

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
const pass = (m: string) => console.log(`PASS: ${m}`);

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

  let lab: ReturnType<typeof createInternalDb> | undefined;

  try {
    step('0. provision + migrate a fresh database on :5433 (includes 055_sync_quarantine)');
    await provisionDb(adminDb, LAB_DB);
    ok(`created ${LAB_DB}`);

    lab = createInternalDb(urlFor(LAB_DB));
    const labDb = lab.db;
    await migrateInternal(labDb as unknown as Kysely<unknown>);
    ok('migrated lab (internal) to latest');

    // The sync_quarantine table exists (migration 055 ran) and starts empty.
    const quarantine = createSyncQuarantineStore(labDb);
    assert((await quarantine.list()).length === 0, 'sync_quarantine starts empty');
    assert((await readChangeCursor(labDb, 'sync-pull')) === 0, `'sync-pull' cursor starts at 0`);

    // ── The in-process central window. Pre-heal it serves the poison at seq 5 with a per-row config record
    //    sequenced BEHIND it at seq 6 — the record the wedge blocks. Post-heal (operator fixed the cause,
    //    central re-publishes the system) it serves the same entity again at seq 7 so the runner's
    //    holdSuccess path genuinely clears the quarantine row. ──
    const poisonRecord: PullRecord = { seq: 5, entityType: POISON_TYPE, entityId: POISON_ID, op: 'upsert', body: {} } as PullRecord;
    const victimRecord: PullRecord = { seq: 6, entityType: 'setting', entityId: VICTIM_ID, op: 'upsert', body: 'on' } as PullRecord;
    const republishRecord: PullRecord = { seq: 7, entityType: POISON_TYPE, entityId: POISON_ID, op: 'upsert', body: {} } as PullRecord;

    let healPublished = false; // central has re-published the (now-fixed) system at seq 7
    const postPull = async (req: PullRequest): Promise<PullResponse> => {
      const fromSeq = typeof req.fromSeq === 'number' ? req.fromSeq : 0;
      if (fromSeq < 6) return { records: [poisonRecord, victimRecord], nextSeq: 6 };
      if (healPublished && fromSeq < 7) return { records: [republishRecord], nextSeq: 7 };
      return { records: [], nextSeq: healPublished ? 7 : 6 };
    };

    // applyRecord: THROWS for the poison system (a reproducibly-failing bulk apply) until the cause is
    // "fixed"; records every setting it applies so the unwedge is directly observable.
    let causeFixed = false;
    const appliedSettings: string[] = [];
    const appliedSystems: string[] = [];
    const applyRecord = async (rec: PullRecord): Promise<'applied' | 'skipped'> => {
      if (rec.entityType === POISON_TYPE) {
        if (!causeFixed) throw new Error(`bulk apply failed for ${rec.entityId}: upstream expansion is malformed`);
        appliedSystems.push(rec.entityId);
        return 'applied';
      }
      appliedSettings.push(rec.entityId);
      return 'applied';
    };

    // The REAL runner, wired to the REAL quarantine store + the REAL 'sync-pull' cursor row, exactly as
    // bootstrap does (holdFailure maps status 'quarantined' → 'quarantine', else 'hold').
    const runner = createSyncPullRunner({
      getToken: async () => 'dummy-token', // no HTTP in this harness (flagged shortcut)
      postPull,
      applyRecord,
      readCursor: () => readChangeCursor(labDb, 'sync-pull'),
      advanceCursor: (seq) => advanceChangeCursor(labDb, 'sync-pull', seq),
      holdFailure: (rec, err) =>
        quarantine
          // `body` mirrors the production wiring in bootstrap/src/index.ts: the record's descriptor is
          // persisted on the quarantine row so an operator retry can replay central's REAL signal
          // (url/version/kind/resourceId/generation) instead of an empty one. Keep this in sync with
          // bootstrap — a harness that drops `body` would silently prove the wrong thing if this file
          // is ever extended to cover the retry path.
          .recordFailure(rec.entityType, rec.entityId, { seq: rec.seq, error: err.message, body: rec.body, threshold: THRESHOLD })
          .then((r) => (r.status === 'quarantined' ? 'quarantine' : 'hold')),
      holdSuccess: (rec) => quarantine.clear(rec.entityType, rec.entityId),
      logger: {
        info() {},
        warn(o: unknown, m?: string) { console.log('  [sync.warn]', m ?? '', o); },
        debug() {},
        error(o: unknown, m?: string) { console.log('  [sync.error]', m ?? '', o); },
      } as never,
    });

    // ── 1. Cycle 1: the poison fails → HELD. The cursor does not move and the config record BEHIND the
    //    poison is blocked. This is the wedge, reproduced. ──
    step('1. cycle #1 — poison bulk fails → cursor HELD, the config behind it is blocked (the wedge)');
    const applied1 = await runner.runCycle();
    assert(applied1 === 0, `cycle #1 applied 0 records (got ${applied1})`);
    assert((await readChangeCursor(labDb, 'sync-pull')) === 0, `'sync-pull' cursor still 0 (held)`);
    assert(appliedSettings.length === 0, `THE WEDGE: setting '${VICTIM_ID}' behind the poison did NOT apply (got [${appliedSettings.join(',')}])`);
    const q1 = await quarantine.get(POISON_TYPE, POISON_ID);
    assert(q1?.status === 'holding', `quarantine row is 'holding' after cycle #1 (got '${q1?.status}')`);
    assert(q1?.attempts === 1, `quarantine attempts === 1 after cycle #1 (got ${q1?.attempts})`);
    assert(q1?.lastSeq === 5, `quarantine row records the failing seq 5 (got ${q1?.lastSeq})`);
    assert(q1?.quarantinedAt === null, `quarantine row is not yet stamped quarantined_at`);

    // ── 2. Cycle 2: still under threshold → still held. Transient-failure semantics preserved: a bulk that
    //    fails once or twice replays rather than being abandoned. ──
    step('2. cycle #2 — still under threshold → still HELD (transient-failure semantics preserved)');
    const applied2 = await runner.runCycle();
    assert(applied2 === 0, `cycle #2 applied 0 records (got ${applied2})`);
    assert((await readChangeCursor(labDb, 'sync-pull')) === 0, `'sync-pull' cursor still 0 after cycle #2`);
    assert(appliedSettings.length === 0, `setting '${VICTIM_ID}' still blocked after cycle #2 (got [${appliedSettings.join(',')}])`);
    const q2 = await quarantine.get(POISON_TYPE, POISON_ID);
    assert(q2?.status === 'holding', `quarantine row still 'holding' after cycle #2 (got '${q2?.status}')`);
    assert(q2?.attempts === 2, `quarantine attempts === 2 after cycle #2 (got ${q2?.attempts})`);
    pass('the wedge is faithfully reproduced: two cycles, cursor pinned, config blocked');

    // ── 3. Cycle 3: the threshold is crossed → QUARANTINE. The runner advances PAST the poison, the window
    //    completes, and the config record that was blocked FINALLY APPLIES. This is the crux of S7-A. ──
    step('3. cycle #3 — threshold crossed → QUARANTINED, cursor advances, THE BLOCKED CONFIG APPLIES');
    const applied3 = await runner.runCycle();
    assert(applied3 === 1, `cycle #3 applied 1 record — the previously-blocked setting (got ${applied3})`);
    const q3 = await quarantine.get(POISON_TYPE, POISON_ID);
    assert(q3?.status === 'quarantined', `quarantine row is 'quarantined' after cycle #3 (got '${q3?.status}')`);
    assert(q3?.attempts === 3, `quarantine attempts === 3 (== threshold) after cycle #3 (got ${q3?.attempts})`);
    assert(q3?.quarantinedAt !== null, `quarantine row is stamped quarantined_at`);
    assert(
      (q3?.lastError ?? '').includes('upstream expansion is malformed'),
      `quarantine row carries the real apply error for the operator (got '${q3?.lastError}')`,
    );
    const cursor3 = await readChangeCursor(labDb, 'sync-pull');
    assert(cursor3 === 6, `'sync-pull' cursor ADVANCED to 6 — the stream is unwedged (got ${cursor3})`);
    // THE CRUX: the config record sequenced behind the poison finally landed.
    assert(
      appliedSettings.includes(VICTIM_ID),
      `THE WEDGE IS BROKEN: setting '${VICTIM_ID}' behind the quarantined poison APPLIED (got [${appliedSettings.join(',')}])`,
    );
    assert(appliedSystems.length === 0, `the poison system itself never applied (correctly, got [${appliedSystems.join(',')}])`);
    // The quarantined entity is visible to the operator through the store's list() surface.
    const listed = await quarantine.list();
    assert(listed.length === 1, `quarantine list() surfaces exactly 1 row for the operator (got ${listed.length})`);
    assert(
      listed[0]?.entityType === POISON_TYPE && listed[0]?.entityId === POISON_ID,
      `quarantine list() names the poison entity ${POISON_TYPE}/${POISON_ID}`,
    );
    pass('THE CRUX: quarantine unwedged the ordered stream and the blocked config applied');

    // ── 4. Heal: the operator fixes the upstream cause and central re-publishes the system. The record now
    //    applies, and the runner's holdSuccess path CLEARS the durable quarantine row — no manual cleanup. ──
    step('4. cycle #4 — cause fixed + system re-published → applies → holdSuccess CLEARS the quarantine row');
    causeFixed = true;
    healPublished = true;
    const applied4 = await runner.runCycle();
    assert(applied4 === 1, `cycle #4 applied the re-published system (got ${applied4})`);
    assert(appliedSystems.includes(POISON_ID), `the previously-poison system ${POISON_ID} applied successfully`);
    const q4 = await quarantine.get(POISON_TYPE, POISON_ID);
    assert(q4 === undefined, `quarantine row CLEARED by the runner's holdSuccess path (got ${JSON.stringify(q4)})`);
    assert((await quarantine.list()).length === 0, 'quarantine list() is empty again — nothing left for the operator');
    const cursor4 = await readChangeCursor(labDb, 'sync-pull');
    assert(cursor4 === 7, `'sync-pull' cursor advanced to 7 after the heal (got ${cursor4})`);
    pass('healed: a successful apply of the entity clears its quarantine automatically');

    // ── 5. Steady state: nothing left to pull, no drift. ──
    step('5. cycle #5 — steady state: nothing to pull, cursor stable, quarantine empty');
    const applied5 = await runner.runCycle();
    assert(applied5 === 0, `cycle #5 applied 0 records (got ${applied5})`);
    assert((await readChangeCursor(labDb, 'sync-pull')) === 7, `'sync-pull' cursor unchanged at 7`);
    assert((await quarantine.list()).length === 0, 'quarantine still empty');
    pass('steady state: no re-apply, no cursor drift, no quarantine resurrection');
  } catch (e) {
    if (failures === 0) failures++;
    console.error('\n[FAIL]', e instanceof Error ? e.stack : e);
  } finally {
    // Close the instance handle BEFORE dropping (DROP DATABASE needs no live sessions; WITH FORCE backstops).
    try { await lab?.close(); } catch { /* ignore */ }
    try {
      await provisionDrop(adminDb, LAB_DB);
    } catch (e) { console.error('  [cleanup] drop failed', e); }
    await admin.close();
  }

  if (failures === 0) {
    console.log('\n✅ sync:quarantine:accept PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ sync:quarantine:accept FAILED');
    process.exit(1);
  }
}

void main();
