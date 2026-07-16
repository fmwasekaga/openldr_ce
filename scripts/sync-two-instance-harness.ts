// Repeatable TWO-INSTANCE end-to-end distributed-sync harness (`pnpm sync:e2e`). This is the one
// harness that exercises the FULL enroll → push → pull loop the way production runs it: two logically
// separate OpenLDR instances (a CENTRAL and a LAB) live in ONE process, but the lab talks to central
// over a REAL localhost HTTP hop authenticated by a REAL Keycloak-minted machine token. No second OS
// process, no docker orchestration beyond the already-running Keycloak + Postgres.
//
// It closes the documented S1/S2 gap: sync:accept / sync:pull:accept prove the data round-trip through
// an IN-PROCESS `postPush`/`postPull` shortcut (no HTTP, no JWKS, a stub site principal). Here BOTH the
// push and the pull cross a real `fetch` to a live Fastify `POST /api/sync/push` / `POST /api/sync/pull`
// on a central `buildApp(ctx)`, and the bearer is a real `client_credentials` access token minted by the
// same @openldr/sync token provider the bootstrap host wires — so the whole transport + auth chain
// (client-credentials → JWKS verifyToken → site_id claim → sitePrincipal) is proven, not stubbed.
//
// Topology (four fresh Postgres DBs on :5433; each instance = internal + external, like the other
// acceptance harnesses):
//   - openldr_e2e_central         : CENTRAL internal (fhir.* mirror target + reference_change_log source)
//   - openldr_e2e_central_target  : CENTRAL external (canonical read model, asserted after push)
//   - openldr_e2e_lab             : LAB internal (site-stamped fhir.* + the 'sync-push'/'sync-pull' cursors)
//   - openldr_e2e_lab_target      : LAB external (keeps the lab ctx's projection worker quiet)
//
// The two instances are provisioned as REAL AppContexts (createAppContext) off derived Configs that only
// differ in INTERNAL_DATABASE_URL / TARGET_DATABASE_URL. Neither has sync.* app_settings, so bootstrap's
// auto-started sync workers stay dormant — this harness constructs the push/pull runners itself (from the
// same @openldr/sync factories bootstrap uses) so it can drive one deterministic cycle per direction with
// the enrolled client's real token + a real HTTP `fetch`.
//
// CRITICAL — SKIPS CLEANLY (exit 0) when the box has no real Keycloak admin OR no Postgres. Mirrors
// sync-enroll-live-acceptance.ts's skip guard: it runs only when OIDC_ISSUER_URL +
// KEYCLOAK_ADMIN_CLIENT_ID/SECRET are set AND AUTH_DEV_BYPASS is not forcing a bypass AND the admin
// Postgres on :5433 is reachable. Migrations are applied IN-HARNESS on all four DBs, so there is no
// external `openldr db migrate` prereq.
//
// Run: pnpm sync:e2e
//
// Env overrides:
//   ADMIN_DATABASE_URL (postgres://openldr:openldr@localhost:5433/openldr) — maintenance DB used to
//   CREATE/DROP the four test databases.
//   SYNC_E2E_LOG_LEVEL (warn) — LOG_LEVEL for the two AppContexts (raise to 'info'/'debug' to trace).
import { type Kysely, sql } from 'kysely';
import {
  createInternalDb,
  createRelationalWriter,
  createMigrator,
  internalMigrations,
  externalMigrations,
  createReferenceApplier,
  reprojectAll,
  fetchSafeChangeRows,
  readCursor,
  advanceCursor,
  type ExternalSchema,
} from '@openldr/db';
import {
  createSyncPushRunner,
  createSyncPullRunner,
  createAmendmentPullRunner,
  createSyncTokenProvider,
  type PushBatch,
  type PushResponse,
  type PullRequest,
  type PullResponse,
  type AmendmentPullResponse,
} from '@openldr/sync';
import { loadConfig, type Config } from '@openldr/config';
import { createAppContext, enrollSite, revokeSite, type AppContext } from '@openldr/bootstrap';
import type { FhirResource } from '@openldr/fhir';
// Import buildApp from the server package's SOURCE file directly (not the package root: apps/server's
// index.ts self-executes `main()` on import, which would try to boot a real server). tsx resolves
// app.ts's own workspace + fastify imports relative to its location.
import { buildApp } from '../apps/server/src/app';
import type { AddressInfo } from 'node:net';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr';
const urlFor = (dbName: string): string => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
};

const CENTRAL_DB = 'openldr_e2e_central';
const CENTRAL_TARGET_DB = 'openldr_e2e_central_target';
const LAB_DB = 'openldr_e2e_lab';
const LAB_TARGET_DB = 'openldr_e2e_lab_target';
const SITE_ID = 'lab-e2e';

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
const pass = (m: string) => console.log(`PASS: ${m}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Quiet logger for the manually-driven runners (surface real apply/transport failures only).
const runnerLogger = {
  info() {},
  warn(o: unknown, m?: string) { console.log('  [sync.warn]', m ?? '', o); },
  debug() {},
  error(o: unknown, m?: string) { console.error('  [sync.error]', m ?? '', o); },
};

const RUN_TAG = `sync-e2e-${Date.now()}`;
const patId = `${RUN_TAG}-pat`;
const spId = `${RUN_TAG}-sp`;
const srId = `${RUN_TAG}-sr`;
const obsId = `${RUN_TAG}-obs`;
const drId = `${RUN_TAG}-dr`;
const SEED_IDS = [patId, spId, srId, obsId, drId];
const dashId = `${RUN_TAG}-dash`;

// Referentially-consistent FHIR seed graph (matches the S1 push harness so central's canonical
// projection populates every FK-linked read-model table).
function seedResources(): FhirResource[] {
  return [
    { resourceType: 'Patient', id: patId, identifier: [{ system: 'urn:patient', value: 'PID-E2E-1' }], name: [{ family: 'Sync', given: ['Ada'] }], gender: 'female', birthDate: '1985-04-12' },
    { resourceType: 'Specimen', id: spId, type: { coding: [{ code: 'blood' }], text: 'Blood' }, subject: { reference: `Patient/${patId}` }, receivedTime: '2026-05-01T08:00:00Z' },
    { resourceType: 'ServiceRequest', id: srId, status: 'active', intent: 'order', subject: { reference: `Patient/${patId}` }, code: { coding: [{ system: 'http://loinc.org', code: '58410-2', display: 'CBC panel' }] }, authoredOn: '2026-05-01T09:00:00Z' },
    { resourceType: 'Observation', id: obsId, status: 'final', basedOn: [{ reference: `ServiceRequest/${srId}` }], subject: { reference: `Patient/${patId}` }, specimen: { reference: `Specimen/${spId}` }, code: { coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }] }, valueQuantity: { value: 13.5, unit: 'g/dL' }, effectiveDateTime: '2026-05-02T00:00:00Z' },
    { resourceType: 'DiagnosticReport', id: drId, status: 'final', subject: { reference: `Patient/${patId}` }, code: { coding: [{ system: 'http://loinc.org', code: '58410-2', display: 'CBC panel' }] }, result: [{ reference: `Observation/${obsId}` }], issued: '2026-05-02T10:00:00Z' },
  ] as unknown as FhirResource[];
}

async function provisionDb(admin: Kysely<unknown>, dbName: string): Promise<void> {
  await sql.raw(`drop database if exists ${dbName} with (force)`).execute(admin);
  await sql.raw(`create database ${dbName}`).execute(admin);
}
async function dropDb(admin: Kysely<unknown>, dbName: string): Promise<void> {
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

async function main(): Promise<void> {
  // ── Skip guard: no real Keycloak admin → skip cleanly (exit 0). loadConfig() can throw on a bare
  //    dev box (required env absent); that is also a clean skip, never a crash. ──
  let cfg: Config;
  try {
    cfg = loadConfig();
  } catch {
    console.log('⏭ sync:e2e SKIPPED — needs Keycloak admin + two Postgres DBs');
    process.exit(0);
  }
  if (
    !cfg.OIDC_ISSUER_URL ||
    !cfg.KEYCLOAK_ADMIN_CLIENT_ID ||
    !cfg.KEYCLOAK_ADMIN_CLIENT_SECRET ||
    cfg.AUTH_DEV_BYPASS === true
  ) {
    console.log('⏭ sync:e2e SKIPPED — needs Keycloak admin + two Postgres DBs');
    process.exit(0);
  }

  // Admin Postgres reachability probe — no Postgres → clean skip too.
  const admin = createInternalDb(ADMIN_URL);
  const adminDb = admin.db as unknown as Kysely<unknown>;
  try {
    await sql`select 1`.execute(adminDb);
  } catch {
    await admin.close().catch(() => undefined);
    console.log('⏭ sync:e2e SKIPPED — needs Keycloak admin + two Postgres DBs');
    process.exit(0);
  }

  const logLevel = process.env.SYNC_E2E_LOG_LEVEL ?? 'warn';
  const centralCfg: Config = {
    ...cfg,
    LOG_LEVEL: logLevel,
    TARGET_STORE_ADAPTER: 'pg',
    INTERNAL_DATABASE_URL: urlFor(CENTRAL_DB),
    TARGET_DATABASE_URL: urlFor(CENTRAL_TARGET_DB),
  } as Config;
  const labCfg: Config = {
    ...cfg,
    LOG_LEVEL: logLevel,
    TARGET_STORE_ADAPTER: 'pg',
    INTERNAL_DATABASE_URL: urlFor(LAB_DB),
    TARGET_DATABASE_URL: urlFor(LAB_TARGET_DB),
  } as Config;

  let failures = 0;
  const assert = (cond: boolean, detail: string) => {
    if (cond) { ok(detail); return; }
    failures++;
    console.error(`FAIL: ${detail}`);
    throw new Error(detail);
  };

  let centralCtx: AppContext | undefined;
  let labCtx: AppContext | undefined;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let centralTarget: ReturnType<typeof createInternalDb> | undefined;
  let enrolled: Awaited<ReturnType<typeof enrollSite>> | undefined;

  try {
    // ── 0. Provision + migrate four fresh DBs (internal + external per instance). ──
    step('0. provision + migrate four fresh databases on :5433');
    await provisionDb(adminDb, CENTRAL_DB);
    await provisionDb(adminDb, CENTRAL_TARGET_DB);
    await provisionDb(adminDb, LAB_DB);
    await provisionDb(adminDb, LAB_TARGET_DB);
    for (const [name, url, kind] of [
      [CENTRAL_DB, urlFor(CENTRAL_DB), 'internal'],
      [CENTRAL_TARGET_DB, urlFor(CENTRAL_TARGET_DB), 'external'],
      [LAB_DB, urlFor(LAB_DB), 'internal'],
      [LAB_TARGET_DB, urlFor(LAB_TARGET_DB), 'external'],
    ] as const) {
      const h = createInternalDb(url);
      try {
        if (kind === 'internal') await migrateInternal(h.db as unknown as Kysely<unknown>);
        else await migrateExternal(h.db as unknown as Kysely<unknown>);
      } finally {
        await h.close();
      }
      void name;
    }
    ok('created + migrated central(internal+external) + lab(internal+external)');

    // ── 1. Bring up the CENTRAL instance: a real AppContext + a real Fastify app on an ephemeral port. ──
    step('1. start CENTRAL AppContext + Fastify app on an ephemeral localhost port');
    centralCtx = await createAppContext(centralCfg);
    app = await buildApp(centralCtx);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address() as AddressInfo;
    const centralUrl = `http://127.0.0.1:${addr.port}`;
    ok(`central listening at ${centralUrl}`);

    // ── 2. Bring up the LAB instance (its own AppContext). Stamp its site BEFORE any FHIR save so the
    //    change_log carries site_id='lab-e2e' (resolveSiteId memoizes on first save). ──
    step('2. start LAB AppContext + stamp its sync.site_id');
    labCtx = await createAppContext(labCfg);
    await labCtx.internalDb
      .insertInto('app_settings')
      .values({ key: 'sync.site_id', value: SITE_ID })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: SITE_ID }))
      .execute();
    ok(`lab app_settings 'sync.site_id' = '${SITE_ID}'`);

    // ── 3. ENROLL the lab at central (mints a confidential Keycloak client + site_id mapper + registry
    //    row). Pre-clean any leftover from an aborted prior run. ──
    step('3. enroll the lab against central (central mints the client via live Keycloak)');
    await revokeSite(centralCtx, SITE_ID).catch(() => undefined);
    enrolled = await enrollSite(centralCtx, {
      siteId: SITE_ID,
      name: 'E2E Lab',
      centralUrl,
      actor: 'harness',
    });
    assert(enrolled.clientId === `sync-${SITE_ID}`, `enroll minted clientId 'sync-${SITE_ID}' (got '${enrolled.clientId}')`);
    assert(typeof enrolled.clientSecret === 'string' && enrolled.clientSecret.length > 0, 'enroll returned a non-empty clientSecret');
    assert(!!enrolled.oidcIssuer, `enroll returned an oidcIssuer (${enrolled.oidcIssuer})`);

    // The lab's client-credentials token provider — a REAL provider hitting the REAL Keycloak token
    // endpoint with the just-minted secret. Shared by both directions (exactly like bootstrap).
    const tokenProvider = createSyncTokenProvider({
      issuerUrl: enrolled.oidcIssuer,
      clientId: enrolled.clientId,
      clientSecret: enrolled.clientSecret,
    });
    // Prove the enrolled client actually authenticates before wiring the runners (fail fast + clear).
    const probe = await tokenProvider.getToken();
    assert(typeof probe === 'string' && probe.length > 0, 'enrolled client obtained a real client_credentials access token from Keycloak');

    // ── 4. PUSH (lab → central) over REAL HTTP. ──
    step('4. PUSH lab → central over real HTTP (POST /api/sync/push, real bearer token)');
    const pushRunner = createSyncPushRunner({
      internalDb: labCtx.internalDb,
      fetchSafeRows: fetchSafeChangeRows,
      fetchContent: async (resourceType, id, version) => {
        const row = await labCtx!.internalDb
          .selectFrom('fhir.resource_history')
          .select('resource')
          .where('resource_type', '=', resourceType)
          .where('id', '=', id)
          .where('version', '=', version)
          .executeTakeFirst();
        return row?.resource ?? null;
      },
      postPush: async (batch: PushBatch, token: string): Promise<PushResponse> => {
        const res = await fetch(`${centralUrl}/api/sync/push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(batch),
        });
        if (!res.ok) throw new Error(`sync push POST /api/sync/push failed: central responded ${res.status}`);
        return (await res.json()) as PushResponse;
      },
      getToken: () => tokenProvider.getToken(),
      readCursor: () => readCursor(labCtx!.internalDb, 'sync-push'),
      advanceCursor: (seq) => advanceCursor(labCtx!.internalDb, 'sync-push', seq),
      logger: runnerLogger,
    });

    // Seed the lab with the referentially-consistent graph.
    for (const res of seedResources()) await labCtx.fhirStore.save(res);
    const labMaxSeqRow = await labCtx.internalDb.selectFrom('fhir.change_log').select((eb) => eb.fn.max('seq').as('m')).executeTakeFirst();
    const labSeqTarget = labMaxSeqRow?.m != null ? Number(labMaxSeqRow.m) : 0;
    ok(`seeded 5 lab resources (site ${SITE_ID}); lab max(seq)=${labSeqTarget}`);

    // Drain the push runner to completion (capped so a bug cannot infinite-loop). Each cycle now
    // returns a CycleResult (S7): sum `.applied` and keep the last cycle's outcome — the loop only
    // breaks once a cycle reports 0 applied AND no cursor movement, so that final outcome is the
    // drain's real "caught up" (or "central is down") signal.
    const pushCursor = () => readCursor(labCtx!.internalDb, 'sync-push');
    let pushApplied = 0;
    let pushOutcome = '';
    for (let i = 0; i < 50; i++) {
      const before = await pushCursor();
      const r = await pushRunner.runCycle();
      const after = await pushCursor();
      pushApplied += r.applied;
      pushOutcome = r.outcome;
      if (r.applied === 0 && after === before) break;
      await sleep(20);
    }
    assert(pushApplied === 5, `central durably applied all 5 pushed records over HTTP (got ${pushApplied})`);
    // A real HTTP push that reached central and caught up must end 'drained' — never 'failed', which
    // is what a transport/token outage across this hop would report.
    assert(pushOutcome === 'drained', `push drain finishes on a 'drained' cycle over real HTTP (got '${pushOutcome}')`);
    assert((await pushCursor()) >= labSeqTarget, `lab 'sync-push' cursor reached max seq (${await pushCursor()} >= ${labSeqTarget})`);

    // Assert central mirrored every resource at its ORIGIN version with the ORIGIN site_id.
    for (const res of seedResources()) {
      const rt = res.resourceType;
      const id = (res as { id: string }).id;
      const labV = await labCtx.internalDb.selectFrom('fhir.fhir_resources').select('version').where('resource_type', '=', rt).where('id', '=', id).executeTakeFirst();
      const cenV = await centralCtx.internalDb.selectFrom('fhir.fhir_resources').select('version').where('resource_type', '=', rt).where('id', '=', id).executeTakeFirst();
      assert(!!cenV, `central fhir_resources has ${rt}/${id}`);
      assert(!!labV && Number(cenV!.version) === Number(labV.version), `${rt}/${id} central version ${cenV?.version} == lab origin version ${labV?.version}`);
    }
    const cenStamp = await centralCtx.internalDb.selectFrom('fhir.change_log').select(['resource_id', 'site_id']).where('resource_id', 'in', SEED_IDS).execute();
    assert(cenStamp.length === 5, `central change_log has 5 rows for the seed (got ${cenStamp.length})`);
    assert(cenStamp.every((r) => r.site_id === SITE_ID), `every central change_log seed row carries origin site_id='${SITE_ID}'`);
    pass('(push) all 5 mirrored on central at origin version + origin site_id, over real HTTP + real token');

    // Central canonical read model (deterministic synchronous rebuild — mirrors the S1 assertion).
    centralTarget = createInternalDb(urlFor(CENTRAL_TARGET_DB));
    const centralTargetDb = centralTarget.db as unknown as Kysely<ExternalSchema>;
    const relationalWriter = createRelationalWriter(centralTargetDb, 'postgres');
    const rebuilt = await reprojectAll({ internalDb: centralCtx.internalDb, relationalWriter });
    ok(`central reprojectAll rebuilt ${rebuilt} canonical resource(s)`);
    const rowExists = async (table: keyof ExternalSchema, id: string): Promise<boolean> =>
      !!(await centralTargetDb.selectFrom(table).select('id' as never).where('id' as never, '=', id as never).executeTakeFirst());
    assert(await rowExists('patients', patId), `central read-model patients has ${patId}`);
    assert(await rowExists('lab_requests', srId), `central read-model lab_requests has ${srId}`);
    assert(await rowExists('lab_results', obsId), `central read-model lab_results has ${obsId}`);
    pass('(push) central canonical read model populated from the mirrored resources');

    // ── 5. PULL (central → lab) over REAL HTTP. ──
    step('5. PULL central → lab over real HTTP (POST /api/sync/pull, real bearer token)');
    // Central authors a managed reference item (its dashboard store captures to reference_change_log).
    await centralCtx.dashboards.store.create({
      id: dashId,
      ownerId: null,
      name: 'E2E Round-trip Dashboard',
      layout: [] as unknown[],
      widgets: [] as unknown[],
      filters: [] as unknown[],
      refreshIntervalSec: 0,
      isDefault: false,
    } as never);
    ok(`central authored dashboard '${dashId}' (captured to reference_change_log)`);

    const applyRecord = createReferenceApplier(labCtx.internalDb);
    const pullRunner = createSyncPullRunner({
      getToken: () => tokenProvider.getToken(),
      applyRecord: (rec) => applyRecord(rec),
      postPull: async (req: PullRequest, token: string): Promise<PullResponse> => {
        const res = await fetch(`${centralUrl}/api/sync/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(req),
        });
        if (!res.ok) throw new Error(`sync pull POST /api/sync/pull failed: central responded ${res.status}`);
        return (await res.json()) as PullResponse;
      },
      readCursor: () => readCursor(labCtx!.internalDb, 'sync-pull'),
      advanceCursor: (seq) => advanceCursor(labCtx!.internalDb, 'sync-pull', seq),
      logger: runnerLogger,
    });

    // Same CycleResult (S7) drain shape as the push side above.
    const pullCursor = () => readCursor(labCtx!.internalDb, 'sync-pull');
    let pullApplied = 0;
    let pullOutcome = '';
    for (let i = 0; i < 50; i++) {
      const before = await pullCursor();
      const r = await pullRunner.runCycle();
      const after = await pullCursor();
      pullApplied += r.applied;
      pullOutcome = r.outcome;
      if (r.applied === 0 && after === before) break;
      await sleep(20);
    }
    // Kept at the original `>= 1`: central's captured reference window here is whatever its dashboard
    // store emitted, so the exact count is not pinned by this harness (sync:pull:accept pins it at 4).
    assert(pullApplied >= 1, `lab applied the pulled reference record over HTTP (got ${pullApplied})`);
    // A real HTTP pull that reached central and caught up must end 'drained' — never 'failed'.
    assert(pullOutcome === 'drained', `pull drain finishes on a 'drained' cycle over real HTTP (got '${pullOutcome}')`);
    const labDash = await labCtx.internalDb.selectFrom('dashboards').selectAll().where('id', '=', dashId).executeTakeFirst();
    assert(!!labDash, `lab dashboards has '${dashId}' after pull`);
    assert((labDash as { managed_origin?: string } | undefined)?.managed_origin === 'central', `lab dashboard stamped managed_origin='central'`);
    assert((labDash as { name?: string } | undefined)?.name === 'E2E Round-trip Dashboard', `lab dashboard name mirrored central's`);
    pass('(pull) central-managed dashboard landed on the lab stamped managed_origin=central, over real HTTP + real token');

    // The lab's FINAL 'sync-pull' cursor. The drain above ran a final catch-up cycle at this fully-drained
    // position, and central's /api/sync/pull route records fromSeq (what the lab HAS) on EVERY request —
    // so central's last recorded 'sync-pull' value equals this number. Captured now for the S7 A1 assertion
    // below; it is > 0 because reference data was applied (pullApplied >= 1).
    const labPullCursor = await pullCursor();

    // ── 5b. AMENDMENT PULL (central → lab) over REAL HTTP. This is the ONLY live exercise of
    //    /api/sync/pull-amendments in the whole suite (sync:amend:accept calls serveAmendments IN-PROCESS
    //    and says so — "does NOT stand up Fastify/JWKS"), and therefore the only place T5's
    //    'sync-amend-pull' recording is reachable over the wire. Central amends the lab-owned Observation
    //    it mirrored during push (→ v2 + a Provenance = two sync_amendments outbox rows for this site);
    //    the lab drains its amendment stream back down through the real route + real token. ──
    step('5b. AMEND central → lab over real HTTP (POST /api/sync/pull-amendments, real bearer token)');
    const amendResult = await centralCtx.fhirStore.amend({
      resourceType: 'Observation',
      id: obsId,
      status: 'amended',
      patch: { valueQuantity: { value: 14.2, unit: 'g/dL' } },
      agent: 'central-reviewer',
      reason: 'E2E QC re-run: hemoglobin corrected 13.5 → 14.2 g/dL',
    });
    assert(amendResult.siteId === SITE_ID, `central amendment routed to the owning lab '${SITE_ID}' (got '${amendResult.siteId}')`);
    const amendOutbox = await centralCtx.internalDb
      .selectFrom('sync_amendments')
      .select((eb) => eb.fn.max('seq').as('m'))
      .where('site_id', '=', SITE_ID)
      .executeTakeFirst();
    const amendSeqTarget = amendOutbox?.m != null ? Number(amendOutbox.m) : 0;
    ok(`central amended Observation ${obsId} → v${amendResult.version}; central sync_amendments max(seq)=${amendSeqTarget}`);

    const amendPullRunner = createAmendmentPullRunner({
      getToken: () => tokenProvider.getToken(),
      applyRecord: (rec) => labCtx!.fhirStore.applyRemote(rec),
      postPull: async (req: PullRequest, token: string): Promise<AmendmentPullResponse> => {
        const res = await fetch(`${centralUrl}/api/sync/pull-amendments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(req),
        });
        if (!res.ok) throw new Error(`sync amend pull POST /api/sync/pull-amendments failed: central responded ${res.status}`);
        return (await res.json()) as AmendmentPullResponse;
      },
      readCursor: () => readCursor(labCtx!.internalDb, 'sync-amend-pull'),
      advanceCursor: (seq) => advanceCursor(labCtx!.internalDb, 'sync-amend-pull', seq),
      logger: runnerLogger,
    });

    // Same CycleResult (S7) drain shape as the push/pull sides above.
    const amendCursorRead = () => readCursor(labCtx!.internalDb, 'sync-amend-pull');
    let amendApplied = 0;
    let amendOutcome = '';
    for (let i = 0; i < 50; i++) {
      const before = await amendCursorRead();
      const r = await amendPullRunner.runCycle();
      const after = await amendCursorRead();
      amendApplied += r.applied;
      amendOutcome = r.outcome;
      if (r.applied === 0 && after === before) break;
      await sleep(20);
    }
    assert(amendApplied === 2, `lab applied both amendment records (Observation v2 + Provenance) over HTTP (got ${amendApplied})`);
    assert(amendOutcome === 'drained', `amend drain finishes on a 'drained' cycle over real HTTP (got '${amendOutcome}')`);
    const labAmendCursor = await amendCursorRead();
    assert(labAmendCursor >= amendSeqTarget, `lab 'sync-amend-pull' cursor reached max amendment seq (${labAmendCursor} >= ${amendSeqTarget})`);
    const labAmendedObs = (await labCtx.fhirStore.get('Observation', obsId)) as { status?: string } | null;
    assert(labAmendedObs?.status === 'amended', `lab Observation converged to 'amended' after the HTTP amend pull (got '${labAmendedObs?.status}')`);
    pass('(amend) central-authored amendment landed on the lab over real HTTP + real token');

    // ── 5c. THE SLICE UNDER TEST (S7 A1): central recorded each site's REPORTED cursor from the two real
    //    HTTP pull routes, so a later slice can trim reference_change_log / sync_amendments against the
    //    slowest site. The recorded floor is fromSeq — what the lab HAS — captured on every request; each
    //    drain above ran a final catch-up cycle at its fully-drained cursor, so central's last recorded
    //    value per consumer equals the lab's final cursor for that stream. That equality is only reachable
    //    if the recording actually fired: a never-reported site reads EXACTLY 0 (store default), so this
    //    fails hard the moment either T5 report() call is gone — never a vacuous `>= 0`. ──
    step('5d. central recorded the lab-reported pull + amend cursors over the REAL HTTP routes (S7 A1)');
    const pullCur = await centralCtx.syncSiteCursors.get(SITE_ID, 'sync-pull');
    assert(
      labPullCursor > 0 && pullCur === labPullCursor,
      `central recorded 'sync-pull' cursor for ${SITE_ID} == lab's final pull cursor (${pullCur} === ${labPullCursor})`,
    );
    const amendCur = await centralCtx.syncSiteCursors.get(SITE_ID, 'sync-amend-pull');
    assert(
      labAmendCursor > 0 && amendCur === labAmendCursor,
      `central recorded 'sync-amend-pull' cursor for ${SITE_ID} == lab's final amend cursor (${amendCur} === ${labAmendCursor})`,
    );
    pass('(S7 A1) both reported cursors landed on central from the real HTTP pull routes');
  } catch (e) {
    if (failures === 0) failures++;
    console.error('\n[FAIL]', e instanceof Error ? e.stack : e);
  } finally {
    // ── 6. Cleanup: revoke the lab (delete the KC client), close app + both ctxs, drop the four DBs. ──
    step('6. cleanup');
    try { if (centralCtx && enrolled) await revokeSite(centralCtx, SITE_ID); } catch (e) { console.error('  [cleanup] revoke failed', e); }
    try { await app?.close(); } catch { /* ignore */ }
    try { await centralTarget?.close(); } catch { /* ignore */ }
    try { await labCtx?.close(); } catch { /* ignore */ }
    try { await centralCtx?.close(); } catch { /* ignore */ }
    try {
      await dropDb(adminDb, LAB_TARGET_DB);
      await dropDb(adminDb, LAB_DB);
      await dropDb(adminDb, CENTRAL_TARGET_DB);
      await dropDb(adminDb, CENTRAL_DB);
      ok('dropped the four test databases');
    } catch (e) { console.error('  [cleanup] drop failed', e); }
    await admin.close().catch(() => undefined);
  }

  if (failures === 0) {
    console.log('\n✅ sync:e2e PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ sync:e2e FAILED');
    process.exit(1);
  }
}

void main();
