// Two-Postgres integration proof for Distributed Sync S3 — the TERMINOLOGY PULL round-trip
// (central → lab). A CENTRAL instance authors terminology config: a publisher / coding_system /
// term_mapping (metadata, captured per-row into reference_change_log by the admin store), a CodeSystem
// with ~300 concepts (signalled by markTerminologyChanged), and a concept map (signalled by
// upsertMapElements → markConceptMapChanged). A LAB then drains those signals: the metadata flows
// through the SAME per-row pull path as S2 (createReferenceApplier), while the terminology_system /
// concept_map signals route through the S3 bulk keyset transfer (createTerminologyBulkSync) which
// whole-system/whole-map reconciles the lab copy. Every mirrored row is stamped managed_origin='central';
// the lab's OWN local terminology (a distinct code system, a lab-local term_mapping, the curated
// LOCAL_MAP_URL element) is never touched, and a lab row sharing central's system URL is central-won.
//
// This is a REAL-Postgres harness (not pg-mem): reference_change_log's bigserial `seq`, the keyset
// bulk paging (WHERE code > afterCode ORDER BY code LIMIT n), and the whole-system delete-not-in
// reconcile all exercise real PG semantics. It mirrors scripts/sync-pull-live-acceptance.ts (the S2
// pull harness): create fresh DBs on :5433, migrate to latest, construct createInternalDb handles,
// drive the runner to completion, assert against the target tables, and drop the DBs in a finally.
//
// DELIBERATE S3 SHORTCUTS (flagged): this harness does NOT stand up Fastify/JWKS — the HTTP/JWKS
// transport + client-credentials auth are unit-proven elsewhere. Instead THREE in-process functions
// replicate the server endpoints faithfully (apps/server/src/sync-routes.ts is the source of truth):
//   - inProcessPull      → POST /api/sync/pull (window read + dedup-to-latest + descriptor/metadata
//                          serve + deleted-since downgrade)
//   - fetchConceptsPage  → POST /api/sync/terminology/concepts (keyset by `code`)
//   - fetchMapElementsPage → POST /api/sync/terminology/map-elements (row-value keyset by
//                          (source_system, source_code))
// The lab-side applyRecord dispatcher is replicated verbatim from packages/bootstrap/src/index.ts:
// terminology_system→syncSystem, concept_map→syncConceptMap, everything else→createReferenceApplier.
//
// Topology (two logical instances, one internal DB each):
//   - openldr_s3_central : central internal DB (authors terminology; owns reference_change_log)
//   - openldr_s3_lab     : lab internal DB (mirrors central; tracks the 'sync-pull' cursor)
// Terminology entities are independent (no FK graph), so bodies are minimal-but-valid.
//
// Each DB is dropped-if-exists then created fresh and migrated to latest, so the run is repeatable; a
// finally block drops both.
//
// Preconditions: dev Postgres up on :5433 with the maintenance `openldr` DB.
//   docker compose up -d postgres
//
// Run: pnpm sync:terminology:accept
//
// Env override:
//   ADMIN_DATABASE_URL (postgres://openldr:openldr@localhost:5433/openldr) — maintenance DB used to
//   CREATE/DROP the two test databases.
import { type Kysely, sql } from 'kysely';
import {
  createInternalDb,
  createMigrator,
  internalMigrations,
  createFhirStore,
  createTerminologyStore,
  createTerminologyAdminStore,
  createReferenceApplier,
  referenceCapture,
  markTerminologyChanged,
  readCursor,
  advanceCursor,
  LOCAL_MAP_URL,
} from '@openldr/db';
import {
  createTerminologyBulkSync,
  createSyncPullRunner,
  type PullRequest,
  type PullResponse,
  type PullRecord,
  type ConceptsPage,
  type MapElementsPage,
} from '@openldr/sync';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr';
const urlFor = (dbName: string): string => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
};

const CENTRAL_DB = 'openldr_s3_central';
const LAB_DB = 'openldr_s3_lab';

// Small page size so the ~300 concepts span MULTIPLE keyset pages (proves paging + drain).
const CONCEPT_PAGE_LIMIT = 100;
const CONCEPT_COUNT = 300;

// Central-managed terminology identities.
const SYS_URL = 'http://example.org/openldr/s3/codesystem';
const MAP_URL = 'http://example.org/openldr/s3/conceptmap';
// A distinct target system for the central term_mapping (keeps its auto-created DRAFT concept OUT of
// SYS_URL so the concept counts stay clean).
const TM_TARGET_SYS = 'http://example.org/openldr/s3/tm-target';
// The lab's OWN local code system (distinct URL) — must survive untouched.
const LAB_SYS_URL = 'http://example.org/openldr/s3/lab-local-codesystem';

const conceptCode = (n: number): string => `C${String(n).padStart(4, '0')}`;

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
const pass = (m: string) => console.log(`PASS: ${m}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const logger = {
  info() {},
  warn(o: unknown, m?: string) { console.log('  [sync.warn]', m ?? '', o); },
  debug() {},
  error(o: unknown, m?: string) { console.error('  [sync.error]', m ?? '', o); },
};

async function provisionDb(admin: Kysely<unknown>, dbName: string): Promise<void> {
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

    // ── Central stores. The terminology store's saveSystem/upsertConcepts don't capture; signals come
    //    from markTerminologyChanged / upsertMapElements' internal mark. The admin store WITH
    //    referenceCapture emits a per-row reference_change_log row for publisher/coding_system/term_mapping.
    const centralFhir = createFhirStore(centralDb);
    const termStore = createTerminologyStore(centralDb, centralFhir);
    const admin_ = createTerminologyAdminStore(centralDb, undefined, referenceCapture);

    // ── 1. Central authors terminology ──────────────────────────────────────────────────────────
    step('1. central authors publisher + coding_system + term_mapping + code system (300 concepts) + concept map');
    const pub = await admin_.publishers.create({ name: 'S3 Publisher', role: 'external', icon: null });
    const cs = await admin_.codingSystems.create({
      systemCode: 'S3CS', systemName: 'S3 Coding System', url: SYS_URL,
      systemVersion: '1.0', description: 'sync S3 acceptance', active: true, publisherId: pub.id,
    });
    const tmResult = await admin_.termMappings.create({
      fromSystem: SYS_URL, fromCode: conceptCode(1), toSystem: TM_TARGET_SYS, toCode: 'T1',
      toDisplay: 'Target One', mapType: 'SAME-AS', relationship: null, owner: 'central', isActive: true,
    });
    const tmId = tmResult.mapping.id;

    // Code system header + 300 concepts + ONE bulk signal (mimics an import completing).
    await termStore.saveSystem(SYS_URL, '1.0', 'CodeSystem', 'cs-resource-1');
    await termStore.upsertConcepts(
      Array.from({ length: CONCEPT_COUNT }, (_, i) => ({
        system: SYS_URL, code: conceptCode(i + 1), display: `Concept ${i + 1}`, status: 'ACTIVE', properties: null,
      })),
    );
    await markTerminologyChanged(centralDb, SYS_URL);

    // Concept map on a NON-LOCAL url → upsertMapElements auto-signals (markConceptMapChanged).
    await termStore.upsertMapElements([
      { mapUrl: MAP_URL, sourceSystem: SYS_URL, sourceCode: conceptCode(1), targetSystem: TM_TARGET_SYS, targetCode: 'T1', equivalence: 'equivalent' },
      { mapUrl: MAP_URL, sourceSystem: SYS_URL, sourceCode: conceptCode(2), targetSystem: TM_TARGET_SYS, targetCode: 'T2', equivalence: 'wider' },
      { mapUrl: MAP_URL, sourceSystem: SYS_URL, sourceCode: conceptCode(3), targetSystem: TM_TARGET_SYS, targetCode: 'T3', equivalence: 'narrower' },
    ]);
    ok(`authored publisher=${pub.id}, coding_system=${cs.id}, term_mapping=${tmId}, system=${SYS_URL} (${CONCEPT_COUNT} concepts), map=${MAP_URL}`);

    // Assert central reference_change_log holds exactly the 5 expected signals.
    const cenLog = await centralDb
      .selectFrom('reference_change_log')
      .select(['entity_type', 'entity_id', 'op'])
      .execute();
    const has = (type: string, id: string) =>
      cenLog.some((r) => r.entity_type === type && r.entity_id === id && r.op === 'upsert');
    assert(has('publisher', pub.id), `central log has publisher upsert`);
    assert(has('coding_system', cs.id), `central log has coding_system upsert`);
    assert(has('term_mapping', tmId), `central log has term_mapping upsert`);
    assert(has('terminology_system', SYS_URL), `central log has terminology_system signal`);
    assert(has('concept_map', MAP_URL), `central log has concept_map signal`);
    const distinct = new Set(cenLog.map((r) => `${r.entity_type} ${r.entity_id}`));
    assert(distinct.size === 5, `central logged exactly 5 distinct entities (got ${distinct.size})`);

    // ── 2. Lab pre-holds its OWN local terminology (managed_origin NULL) — pull must NEVER touch it ──
    step('2. lab pre-seeds lab-local code system + concepts + term_mapping + LOCAL_MAP_URL element + a shared-URL row');
    await labDb.insertInto('terminology_systems')
      .values({ url: LAB_SYS_URL, version: 'x', kind: 'CodeSystem', resource_id: 'lab-res', generation: 0, managed_origin: null } as never)
      .execute();
    await labDb.insertInto('terminology_concepts').values([
      { system: LAB_SYS_URL, code: 'L1', display: 'Lab One', status: 'ACTIVE', properties: null },
      { system: LAB_SYS_URL, code: 'L2', display: 'Lab Two', status: 'ACTIVE', properties: null },
    ] as never).execute();
    await labDb.insertInto('term_mappings')
      .values({
        id: 'lab-local-tm', from_system: LAB_SYS_URL, from_code: 'L1', to_system: LAB_SYS_URL, to_code: 'L2',
        to_display: 'Lab Two', map_type: 'SAME-AS', relationship: null, owner: 'lab', is_active: true, managed_origin: null,
      } as never)
      .execute();
    await labDb.insertInto('concept_map_elements')
      .values({ map_url: LOCAL_MAP_URL, source_system: LAB_SYS_URL, source_code: 'L1', target_system: LAB_SYS_URL, target_code: 'L2', equivalence: 'equivalent' } as never)
      .execute();
    // Shared-URL pre-hold: a lab row under central's SYS_URL (managed_origin NULL) + a BOGUS concept the
    // central system does not contain — the first drain must central-win (stamp central + drop the bogus).
    await labDb.insertInto('terminology_systems')
      .values({ url: SYS_URL, version: 'lab-bogus', kind: 'CodeSystem', resource_id: 'lab-bogus', generation: 0, managed_origin: null } as never)
      .execute();
    await labDb.insertInto('terminology_concepts')
      .values({ system: SYS_URL, code: 'ZZZZ', display: 'bogus lab concept', status: 'DRAFT', properties: null } as never)
      .execute();
    ok('inserted lab-local system, 2 concepts, term_mapping, LOCAL_MAP element, and a shared-URL bogus row');

    // ── In-process endpoint replicas (flagged S3 shortcuts; sync-routes.ts is the source of truth) ──

    // POST /api/sync/terminology/concepts — keyset by `code`. Reads the CENTRAL db.
    async function fetchConceptsPage(systemUrl: string, afterCode: string | null): Promise<ConceptsPage> {
      let q = centralDb.selectFrom('terminology_concepts').selectAll().where('system', '=', systemUrl);
      if (afterCode) q = q.where('code', '>', afterCode);
      const rows = await q.orderBy('code', 'asc').limit(CONCEPT_PAGE_LIMIT).execute();
      const concepts = rows.map((r) => ({
        code: r.code, display: r.display, status: r.status,
        properties: r.properties == null ? null : typeof r.properties === 'string' ? JSON.parse(r.properties) : r.properties,
      }));
      const nextCode = rows.length === CONCEPT_PAGE_LIMIT ? rows[rows.length - 1].code : null;
      return { concepts, nextCode };
    }

    // POST /api/sync/terminology/map-elements — row-value keyset by (source_system, source_code).
    async function fetchMapElementsPage(
      mapUrl: string,
      afterKey: { sourceSystem: string; sourceCode: string } | null,
    ): Promise<MapElementsPage> {
      const LIMIT = 1000; // few elements → single page; keyset logic still faithful to the route.
      let q = centralDb.selectFrom('concept_map_elements').selectAll().where('map_url', '=', mapUrl);
      if (afterKey) {
        const ass = afterKey.sourceSystem;
        const asc = afterKey.sourceCode;
        q = q.where((eb) =>
          eb.or([eb('source_system', '>', ass), eb.and([eb('source_system', '=', ass), eb('source_code', '>', asc)])]),
        );
      }
      const rows = await q.orderBy('source_system', 'asc').orderBy('source_code', 'asc').limit(LIMIT).execute();
      const elements = rows.map((r) => ({
        sourceSystem: r.source_system, sourceCode: r.source_code, targetSystem: r.target_system,
        targetCode: r.target_code, equivalence: r.equivalence,
      }));
      const nextKey = rows.length === LIMIT
        ? { sourceSystem: rows[rows.length - 1].source_system, sourceCode: rows[rows.length - 1].source_code }
        : null;
      return { elements, nextKey };
    }

    // POST /api/sync/pull descriptor/metadata serve (faithful to sync-routes.ts fetchReferenceBody).
    async function fetchReferenceBody(entityType: PullRecord['entityType'], id: string): Promise<unknown | null> {
      switch (entityType) {
        case 'publisher': {
          const r = await centralDb.selectFrom('publishers').selectAll().where('id', '=', id).executeTakeFirst();
          if (!r) return null;
          const mp = r.match_prefixes == null ? [] : typeof r.match_prefixes === 'string' ? JSON.parse(r.match_prefixes) : r.match_prefixes;
          return { id: r.id, name: r.name, role: r.role, icon: r.icon, matchPrefixes: mp, sortOrder: r.sort_order };
        }
        case 'coding_system': {
          const r = await centralDb.selectFrom('coding_systems').selectAll().where('id', '=', id).executeTakeFirst();
          if (!r) return null;
          return {
            id: r.id, systemCode: r.system_code, systemName: r.system_name, url: r.url,
            systemVersion: r.system_version, description: r.description, active: r.active, publisherId: r.publisher_id,
          };
        }
        case 'term_mapping': {
          const r = await centralDb.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirst();
          if (!r) return null;
          return {
            id: r.id, fromSystem: r.from_system, fromCode: r.from_code, toSystem: r.to_system, toCode: r.to_code,
            toDisplay: r.to_display, mapType: r.map_type, relationship: r.relationship, owner: r.owner, isActive: r.is_active,
          };
        }
        case 'terminology_system': {
          // Signal body is a DESCRIPTOR (NOT the concepts — those drain via fetchConceptsPage).
          const r = await centralDb.selectFrom('terminology_systems').selectAll().where('url', '=', id).executeTakeFirst();
          return r ? { url: r.url, version: r.version, kind: r.kind, resourceId: r.resource_id, generation: Number(r.generation) } : null;
        }
        case 'concept_map': {
          const r = await centralDb.selectFrom('concept_map_state').selectAll().where('map_url', '=', id).executeTakeFirst();
          return r ? { mapUrl: r.map_url, generation: Number(r.generation) } : null;
        }
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
          logger.warn({ error: e instanceof Error ? e.message : String(e), entityType, entityId: r.entity_id, seq }, 'inProcessPull: fetchReferenceBody failed, skipping');
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

    // ── Lab-side pull runner deps (in-process transport; auth/HTTP unit-proven elsewhere) ──
    const referenceApplier = createReferenceApplier(labDb);
    const termBulk = createTerminologyBulkSync({
      labDb,
      getToken: async () => 'dummy-token',
      fetchConceptsPage: (systemUrl, afterCode) => fetchConceptsPage(systemUrl, afterCode),
      fetchMapElementsPage: (mapUrl, afterKey) => fetchMapElementsPage(mapUrl, afterKey),
      logger,
    });
    // Dispatcher — replicated verbatim from packages/bootstrap/src/index.ts.
    const applyRecord = async (rec: PullRecord): Promise<'applied' | 'skipped'> => {
      if (rec.entityType === 'terminology_system') {
        await termBulk.syncSystem(rec.entityId, rec.body);
        return 'applied';
      }
      if (rec.entityType === 'concept_map') {
        await termBulk.syncConceptMap(rec.entityId, rec.body);
        return 'applied';
      }
      return referenceApplier(rec);
    };
    const runner = createSyncPullRunner({
      applyRecord,
      postPull: (req) => inProcessPull(req),
      getToken: async () => 'dummy-token',
      readCursor: () => readCursor(labDb, 'sync-pull'), // default hold predicate covers the terminology kinds
      advanceCursor: (seq) => advanceCursor(labDb, 'sync-pull', seq),
      logger,
    });

    const labCursor = () => readCursor(labDb, 'sync-pull');
    const countConcepts = async (db: typeof labDb, system: string): Promise<number> => {
      const r = await db.selectFrom('terminology_concepts').select((eb) => eb.fn.countAll().as('n')).where('system', '=', system).executeTakeFirst();
      return r?.n != null ? Number(r.n) : -1;
    };

    // Returns total applied + cycle count + the last cycle's CycleResult outcome (S7) — the loop only
    // breaks once a cycle reports 0 applied AND no cursor movement, so that final cycle's outcome is
    // the drain's real "caught up" (or "stuck") signal. This harness's window mixes per-row reference
    // records with the two bulk (hold-kind) entities `terminology_system`/`concept_map`; since
    // applyRecord never throws here, every non-empty window fully applies and reports 'progressed'.
    async function drain(maxIters = 200): Promise<{ cycles: number; applied: number; lastOutcome: string }> {
      let applied = 0;
      let cycles = 0;
      let lastOutcome = '';
      for (let i = 0; i < maxIters; i++) {
        const before = await labCursor();
        const r = await runner.runCycle();
        const after = await labCursor();
        applied += r.applied;
        lastOutcome = r.outcome;
        cycles++;
        if (r.applied === 0 && after === before) break;
        await sleep(10);
      }
      return { cycles, applied, lastOutcome };
    }

    // ── 3. Pull drain #1: replicate central → lab ──
    step('3. pull drain #1: replicate central → lab');
    const d1 = await drain();
    ok(`drain #1: ${d1.cycles} cycle(s), ${d1.applied} record(s) applied by lab, last outcome '${d1.lastOutcome}'`);
    assert(d1.applied === 5, `lab applied all 5 signalled entities (got ${d1.applied})`);
    assert(d1.lastOutcome === 'drained', `drain #1 finishes on a 'drained' cycle (got '${d1.lastOutcome}')`);
    const centralMaxSeq = Number((await centralDb.selectFrom('reference_change_log').select((eb) => eb.fn.max('seq').as('m')).executeTakeFirst())?.m ?? 0);
    assert((await labCursor()) === centralMaxSeq, `lab 'sync-pull' cursor reached central max seq (${await labCursor()} === ${centralMaxSeq})`);

    // ── Assertion (a): lab mirrors all central terminology, stamped managed_origin='central' ──
    step('4. assert (a) lab mirrors central terminology, stamped central');
    assert((await countConcepts(labDb, SYS_URL)) === CONCEPT_COUNT, `lab has all ${CONCEPT_COUNT} concepts for the central system`);
    const labSys = await labDb.selectFrom('terminology_systems').selectAll().where('url', '=', SYS_URL).executeTakeFirst();
    assert((labSys as { managed_origin?: string } | undefined)?.managed_origin === 'central', `lab terminology_systems[${SYS_URL}] stamped managed_origin=central`);
    assert(Number((labSys as { generation?: unknown } | undefined)?.generation) === 1, `lab system generation === 1 (got ${(labSys as { generation?: unknown } | undefined)?.generation})`);
    const labPub = await labDb.selectFrom('publishers').selectAll().where('id', '=', pub.id).executeTakeFirst();
    const labCs = await labDb.selectFrom('coding_systems').selectAll().where('id', '=', cs.id).executeTakeFirst();
    const labTm = await labDb.selectFrom('term_mappings').selectAll().where('id', '=', tmId).executeTakeFirst();
    assert(!!labPub && (labPub as { managed_origin?: string }).managed_origin === 'central', `lab publisher mirrored + stamped central`);
    assert(!!labCs && (labCs as { managed_origin?: string }).managed_origin === 'central', `lab coding_system mirrored + stamped central`);
    assert(!!labTm && (labTm as { managed_origin?: string }).managed_origin === 'central', `lab term_mapping mirrored + stamped central`);
    const labMapCount = Number((await labDb.selectFrom('concept_map_elements').select((eb) => eb.fn.countAll().as('n')).where('map_url', '=', MAP_URL).executeTakeFirst())?.n ?? 0);
    assert(labMapCount === 3, `lab concept_map_elements[${MAP_URL}] mirrored (3 elements, got ${labMapCount})`);
    const labMapState = await labDb.selectFrom('concept_map_state').selectAll().where('map_url', '=', MAP_URL).executeTakeFirst();
    assert((labMapState as { managed_origin?: string } | undefined)?.managed_origin === 'central', `lab concept_map_state stamped managed_origin=central`);
    pass('(a) all central terminology mirrored + stamped central');

    // ── Assertion (b): the lab's OWN local terminology is UNTOUCHED ──
    step('5. assert (b) lab-local terminology untouched');
    const labLocalSys = await labDb.selectFrom('terminology_systems').selectAll().where('url', '=', LAB_SYS_URL).executeTakeFirst();
    assert(!!labLocalSys && (labLocalSys as { managed_origin?: string | null }).managed_origin == null, `lab-local system present + managed_origin still NULL`);
    assert((await countConcepts(labDb, LAB_SYS_URL)) === 2, `lab-local system's 2 concepts intact`);
    const labLocalTm = await labDb.selectFrom('term_mappings').selectAll().where('id', '=', 'lab-local-tm').executeTakeFirst();
    assert(!!labLocalTm && (labLocalTm as { managed_origin?: string | null }).managed_origin == null, `lab-local term_mapping present + managed_origin still NULL`);
    const localMapEl = await labDb.selectFrom('concept_map_elements').select((eb) => eb.fn.countAll().as('n')).where('map_url', '=', LOCAL_MAP_URL).executeTakeFirst();
    assert(Number(localMapEl?.n ?? 0) === 1, `lab-local LOCAL_MAP_URL element untouched (1 row)`);
    pass('(b) lab-local terminology untouched by pull');

    // ── Assertion (d): shared-URL central-wins (the bogus lab concept is gone; system matches central) ──
    step('6. assert (d) shared-URL central-won: the bogus lab concept is gone; system matches central exactly');
    const bogus = await labDb.selectFrom('terminology_concepts').selectAll().where('system', '=', SYS_URL).where('code', '=', 'ZZZZ').executeTakeFirst();
    assert(!bogus, `bogus lab concept 'ZZZZ' under the shared URL was removed by the whole-system reconcile`);
    assert((await countConcepts(labDb, SYS_URL)) === CONCEPT_COUNT, `shared-URL system has exactly central's ${CONCEPT_COUNT} concepts (no lab extras)`);
    pass('(d) shared-URL system central-won');

    // ── Assertion (c): central adds + removes a concept + re-signals → lab reflects both ──
    step('7. assert (c) central add + remove a concept + generation bump → lab reflects the ADD and the REMOVAL');
    await termStore.upsertConcepts([{ system: SYS_URL, code: conceptCode(CONCEPT_COUNT + 1), display: 'Concept 301 (added)', status: 'ACTIVE', properties: null }]);
    await centralDb.deleteFrom('terminology_concepts').where('system', '=', SYS_URL).where('code', '=', conceptCode(1)).execute();
    await markTerminologyChanged(centralDb, SYS_URL); // generation 1 → 2
    const dGen = await drain();
    ok(`gen-bump drain: ${dGen.cycles} cycle(s), ${dGen.applied} applied`);
    const added = await labDb.selectFrom('terminology_concepts').selectAll().where('system', '=', SYS_URL).where('code', '=', conceptCode(CONCEPT_COUNT + 1)).executeTakeFirst();
    const removed = await labDb.selectFrom('terminology_concepts').selectAll().where('system', '=', SYS_URL).where('code', '=', conceptCode(1)).executeTakeFirst();
    assert(!!added, `lab reflects the ADDED concept ${conceptCode(CONCEPT_COUNT + 1)}`);
    assert(!removed, `lab reflects the REMOVAL of concept ${conceptCode(1)} (whole-system reconcile deleted it)`);
    assert((await countConcepts(labDb, SYS_URL)) === CONCEPT_COUNT, `lab concept count still ${CONCEPT_COUNT} after +1/-1`);
    const labSys2 = await labDb.selectFrom('terminology_systems').selectAll().where('url', '=', SYS_URL).executeTakeFirst();
    assert(Number((labSys2 as { generation?: unknown } | undefined)?.generation) === 2, `lab system generation advanced to 2`);
    pass('(c) add + removal both propagated via generation bump');

    // ── Assertion (e): re-drain with no central change → 0 applied, cursor unchanged ──
    step('8. assert (e) idempotent re-drain: 0 applied, cursor unchanged');
    const cursorBefore = await labCursor();
    const cyc = await runner.runCycle();
    const cursorAfter = await labCursor();
    assert(cyc.applied === 0, `final runCycle applied 0 records (got ${cyc.applied})`);
    assert(cyc.outcome === 'drained', `final runCycle reports outcome 'drained' (got '${cyc.outcome}')`);
    assert(cursorAfter === cursorBefore, `lab 'sync-pull' cursor unchanged (${cursorAfter} === ${cursorBefore})`);
    pass('(e) idempotent: no re-apply, no cursor drift');
  } catch (e) {
    if (failures === 0) failures++;
    console.error('\n[FAIL]', e instanceof Error ? e.stack : e);
  } finally {
    try { await central?.close(); } catch { /* ignore */ }
    try { await lab?.close(); } catch { /* ignore */ }
    try {
      await provisionDrop(adminDb, CENTRAL_DB);
      await provisionDrop(adminDb, LAB_DB);
    } catch (e) { console.error('  [cleanup] drop failed', e); }
    await admin.close();
  }

  if (failures === 0) {
    console.log('\n✅ sync:terminology:accept PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ sync:terminology:accept FAILED');
    process.exit(1);
  }
}

void main();
