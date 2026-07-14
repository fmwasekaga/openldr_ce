// Live bundle store-and-forward acceptance for Distributed Sync S5 (`pnpm sync:bundle:accept`). This
// is the offline sibling of scripts/sync-two-instance-harness.ts (`pnpm sync:e2e`): where that harness
// proves the ONLINE push/pull loop over a real HTTP hop, this one proves the OFFLINE signed-bundle loop
// through the REAL bootstrap orchestrations (exportPushBundle / importPushBundle / exportPullBundle /
// importPullBundle), real ed25519 signing exchanged at enroll time, and real file IO. No Fastify app
// and no token provider are needed — a bundle crosses an air gap as a file, not a socket.
//
// What it proves end-to-end, against a live Keycloak admin + Postgres on :5433:
//   1. enrollSite mints the site + a fresh ed25519 signing keypair; central persists ONLY the site's
//      PUBLIC key (sync_sites.signing_public_key) and never the private key.
//   2. PUSH round-trip: the lab exports a signed push bundle of its change_log window to a file, central
//      imports the file bytes, and every seeded resource is mirrored at its ORIGIN version with the
//      origin site_id + central records the piggybacked lab pull cursor (reported_pull_cursor).
//   3. Tamper / wrong-key rejection: a byte-tampered payload and a bundle re-signed with a throwaway key
//      are both rejected with BundleSignatureError, and a re-import of the GOOD bundle is idempotent
//      (applyRemote monotonic → nothing re-applied).
//   4. PULL round-trip incl. terminology: central authors a managed dashboard AND a terminology system,
//      exports a signed pull bundle that carries the dashboard record AND the terminology_system record
//      with its concepts EMBEDDED in the body, and the lab import lands the dashboard (managed_origin=
//      central) and the whole terminology system's concepts (system stamped managed_origin=central).
//   5. Gap rejection: a pull bundle whose fromCursor skips ahead of the lab's consumed 'sync-pull'
//      cursor is rejected with BundleGapError (the reference applier can regress a table, so an
//      out-of-order window must be refused).
//
// CRITICAL — SKIPS CLEANLY (exit 0) when the box has no real Keycloak admin OR no Postgres. Mirrors the
// skip guard in sync-two-instance-harness.ts / sync-enroll-live-acceptance.ts: it runs only when
// OIDC_ISSUER_URL + KEYCLOAK_ADMIN_CLIENT_ID/SECRET are set AND AUTH_DEV_BYPASS is not forcing a bypass
// AND the admin Postgres on :5433 is reachable. Migrations are applied IN-HARNESS on all four DBs, so
// there is no external `openldr db migrate` prereq. The new `052` sync-site-keys migration is part of
// internalMigrations, so it is applied here too.
//
// Run: pnpm sync:bundle:accept
//
// Env overrides:
//   ADMIN_DATABASE_URL (postgres://openldr:openldr@localhost:5433/openldr) — maintenance DB used to
//   CREATE/DROP the four test databases.
//   SYNC_BUNDLE_LOG_LEVEL (warn) — LOG_LEVEL for the two AppContexts.
import { mkdtempSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Kysely, sql } from 'kysely';
import {
  createInternalDb,
  createMigrator,
  internalMigrations,
  externalMigrations,
  createFhirStore,
  createTerminologyStore,
  markTerminologyChanged,
  readCursor,
} from '@openldr/db';
import { packBundle, unpackBundle, type BundleManifest, type BundleRecords } from '@openldr/sync';
import { generatePublisherKeypair, signManifest } from '@openldr/marketplace';
import { loadConfig, type Config } from '@openldr/config';
import {
  createAppContext,
  enrollSite,
  revokeSite,
  ensureCentralKeypair,
  exportPushBundle,
  importPushBundle,
  exportPullBundle,
  importPullBundle,
  BundleSignatureError,
  BundleGapError,
  type AppContext,
} from '@openldr/bootstrap';
import type { FhirResource } from '@openldr/fhir';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr';
const urlFor = (dbName: string): string => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
};

const CENTRAL_DB = 'openldr_bundle_central';
const CENTRAL_TARGET_DB = 'openldr_bundle_central_target';
const LAB_DB = 'openldr_bundle_lab';
const LAB_TARGET_DB = 'openldr_bundle_lab_target';
const SITE_ID = 'lab-bundle-1';

// Central-managed terminology identity for the pull round-trip.
const SYS_URL = 'http://example.org/openldr/s5/codesystem';
const TERM_CONCEPTS = ['A01', 'A02', 'A03', 'A04'];

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
const pass = (m: string) => console.log(`PASS: ${m}`);

const RUN_TAG = `sync-bundle-${Date.now()}`;
const patId = `${RUN_TAG}-pat`;
const spId = `${RUN_TAG}-sp`;
const srId = `${RUN_TAG}-sr`;
const obsId = `${RUN_TAG}-obs`;
const drId = `${RUN_TAG}-dr`;
const SEED_IDS = [patId, spId, srId, obsId, drId];
const dashId = `${RUN_TAG}-dash`;

// Referentially-consistent FHIR seed graph (matches the S1 push + e2e harnesses).
function seedResources(): FhirResource[] {
  return [
    { resourceType: 'Patient', id: patId, identifier: [{ system: 'urn:patient', value: 'PID-BUNDLE-1' }], name: [{ family: 'Bundle', given: ['Ada'] }], gender: 'female', birthDate: '1985-04-12' },
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

/** Mirror sync-bundle's private signBundleBytes so the harness can forge a bundle (wrong-key / gap). */
function signBundle(manifest: BundleManifest, records: BundleRecords, privHex: string): Buffer {
  const base: BundleManifest = { ...manifest };
  delete base.signature;
  const { payloadSha256 } = packBundle(base, records);
  const signature = signManifest(base as unknown as Record<string, unknown>, payloadSha256, Buffer.from(privHex, 'hex'));
  return packBundle({ ...base, signature }, records).bytes;
}

async function main(): Promise<void> {
  // ── Skip guard: no real Keycloak admin → skip cleanly (exit 0). loadConfig() can throw on a bare
  //    dev box (required env absent); that is also a clean skip, never a crash. ──
  let cfg: Config;
  try {
    cfg = loadConfig();
  } catch {
    console.log('⏭ sync:bundle:accept SKIPPED — needs Keycloak admin + two Postgres DBs');
    process.exit(0);
  }
  if (
    !cfg.OIDC_ISSUER_URL ||
    !cfg.KEYCLOAK_ADMIN_CLIENT_ID ||
    !cfg.KEYCLOAK_ADMIN_CLIENT_SECRET ||
    cfg.AUTH_DEV_BYPASS === true
  ) {
    console.log('⏭ sync:bundle:accept SKIPPED — needs Keycloak admin + two Postgres DBs');
    process.exit(0);
  }

  // Admin Postgres reachability probe — no Postgres → clean skip too.
  const admin = createInternalDb(ADMIN_URL);
  const adminDb = admin.db as unknown as Kysely<unknown>;
  try {
    await sql`select 1`.execute(adminDb);
  } catch {
    await admin.close().catch(() => undefined);
    console.log('⏭ sync:bundle:accept SKIPPED — needs Keycloak admin + two Postgres DBs');
    process.exit(0);
  }

  const logLevel = process.env.SYNC_BUNDLE_LOG_LEVEL ?? 'warn';
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

  const outDir = mkdtempSync(join(tmpdir(), 'sync-bundle-'));

  let failures = 0;
  const assert = (cond: boolean, detail: string) => {
    if (cond) { ok(detail); return; }
    failures++;
    console.error(`FAIL: ${detail}`);
    throw new Error(detail);
  };

  let centralCtx: AppContext | undefined;
  let labCtx: AppContext | undefined;
  let enrolled: Awaited<ReturnType<typeof enrollSite>> | undefined;

  try {
    // ── 0. Provision + migrate four fresh DBs (internal + external per instance). ──
    step('0. provision + migrate four fresh databases on :5433 (incl. the 052 sync-site-keys migration)');
    await provisionDb(adminDb, CENTRAL_DB);
    await provisionDb(adminDb, CENTRAL_TARGET_DB);
    await provisionDb(adminDb, LAB_DB);
    await provisionDb(adminDb, LAB_TARGET_DB);
    for (const [url, kind] of [
      [urlFor(CENTRAL_DB), 'internal'],
      [urlFor(CENTRAL_TARGET_DB), 'external'],
      [urlFor(LAB_DB), 'internal'],
      [urlFor(LAB_TARGET_DB), 'external'],
    ] as const) {
      const h = createInternalDb(url);
      try {
        if (kind === 'internal') await migrateInternal(h.db as unknown as Kysely<unknown>);
        else await migrateExternal(h.db as unknown as Kysely<unknown>);
      } finally {
        await h.close();
      }
    }
    ok('created + migrated central(internal+external) + lab(internal+external)');

    // ── 1. Bring up both AppContexts (no Fastify app — bundles are pure file IO). ──
    step('1. start CENTRAL + LAB AppContexts');
    centralCtx = await createAppContext(centralCfg);
    labCtx = await createAppContext(labCfg);
    // Stamp the lab's site_id BEFORE any FHIR save so the change_log carries site_id='lab-bundle-1'
    // (resolveSiteId memoizes on first save).
    await labCtx.appSettings.set('sync.site_id', SITE_ID, 'smoke');
    ok(`lab app_settings 'sync.site_id' = '${SITE_ID}'`);

    // ── 2. ENROLL the lab at central → real ed25519 key exchange. ──
    step('2. enroll the lab at central (mints Keycloak client + ed25519 signing keypair)');
    await revokeSite(centralCtx, SITE_ID).catch(() => undefined); // pre-clean an aborted prior run
    enrolled = await enrollSite(centralCtx, {
      siteId: SITE_ID,
      name: 'Bundle Lab',
      centralUrl: 'http://127.0.0.1:0',
      actor: 'smoke',
    });
    assert(typeof enrolled.signingPrivateKey === 'string' && enrolled.signingPrivateKey.length > 0, 'enroll returned a non-empty signingPrivateKey (site private key)');
    assert(typeof enrolled.centralPublicKey === 'string' && enrolled.centralPublicKey.length > 0, 'enroll returned a non-empty centralPublicKey');

    const site = await centralCtx.syncSites.get(SITE_ID);
    assert(!!site?.signingPublicKey && site.signingPublicKey.length > 0, 'central sync_sites.signing_public_key is set for the enrolled site');
    // The site's PRIVATE key must never be persisted anywhere on central. Prove it: no app_settings
    // value equals it (central stores its OWN signing private key encrypted, never the site's), and the
    // sync_sites row holds only the PUBLIC key.
    const centralSettings = await centralCtx.internalDb.selectFrom('app_settings').select(['key', 'value']).execute();
    const leaked = centralSettings.filter((r) => r.value === enrolled!.signingPrivateKey);
    assert(leaked.length === 0, `no central app_settings value holds the site private key (checked ${centralSettings.length} rows)`);
    assert(site!.signingPublicKey !== enrolled.signingPrivateKey, 'central-stored site key is the PUBLIC key, not the private key');
    pass('(enroll) real key exchange; central persists only the site public key');

    // ── 3. Configure the LAB with the returned keys (write-encrypt the private key). ──
    step('3. configure the lab sync keys (signing private key encrypted, central public key pinned)');
    await labCtx.appSettings.set('sync.signing_private_key', labCtx.encryptSecret(enrolled.signingPrivateKey), 'smoke');
    await labCtx.appSettings.set('sync.central_public_key', enrolled.centralPublicKey, 'smoke');
    ok('lab pinned sync.signing_private_key (encrypted) + sync.central_public_key');

    // ── 4. PUSH bundle round-trip (lab → central) through a FILE. ──
    step('4. PUSH bundle round-trip: lab exports a signed bundle to a file, central imports the bytes');
    for (const res of seedResources()) await labCtx.fhirStore.save(res);
    ok(`seeded 5 lab resources (site ${SITE_ID})`);

    const pushOut = join(outDir, 'push.bundle');
    const { manifest: pushManifest } = await exportPushBundle(labCtx, { out: pushOut });
    assert(pushManifest.siteId === SITE_ID, `push bundle manifest siteId='${SITE_ID}'`);
    assert(pushManifest.recordCount === 5, `push bundle carries 5 records (got ${pushManifest.recordCount})`);
    const pushBytes = await readFile(pushOut);
    ok(`read ${pushBytes.length} push bundle bytes from ${pushOut}`);

    const imp = await importPushBundle(centralCtx, pushBytes);
    assert(imp.applied === 5, `central applied all 5 pushed records (got ${imp.applied})`);
    assert(imp.siteId === SITE_ID, `import reports origin siteId='${SITE_ID}'`);

    // Central mirrored every resource at its ORIGIN version + origin site_id.
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
    // reported_pull_cursor is set from the manifest's piggybacked lab 'sync-pull' position.
    const reported = await centralCtx.syncSites.getReportedPullCursor(SITE_ID);
    assert(reported === (pushManifest.pullCursor ?? 0), `central recorded reported_pull_cursor=${reported} from the piggyback (manifest.pullCursor=${pushManifest.pullCursor})`);
    pass('(push) all 5 mirrored at origin version + origin site_id; piggybacked pull cursor recorded');

    // ── 5. Tamper + wrong-key rejection + idempotent re-import. ──
    step('5. tamper + wrong-key rejection; re-import of the GOOD bundle is idempotent');
    // (a) Byte-tampered payload: re-pack a mutated record with the ORIGINAL signature → sha mismatch.
    const { manifest: tManifest, records: tRecords } = unpackBundle(pushBytes);
    (tRecords.records[0] as { id: string }).id = 'HACKED';
    const tamperedBytes = packBundle(tManifest, tRecords).bytes;
    const tamperedPath = join(outDir, 'push-tampered.bundle');
    await writeFile(tamperedPath, tamperedBytes);
    let tamperRejected = false;
    try { await importPushBundle(centralCtx, await readFile(tamperedPath)); } catch (e) { tamperRejected = e instanceof BundleSignatureError; }
    assert(tamperRejected, 'tampered push bundle rejected with BundleSignatureError');

    // (b) Wrong key: re-sign the (untampered) manifest+records with a throwaway ed25519 key.
    const throwaway = generatePublisherKeypair();
    const throwawayPriv = Buffer.from(throwaway.privateKeyDer).toString('hex');
    const wrongKeyBytes = signBundle(tManifest, unpackBundle(pushBytes).records, throwawayPriv);
    let wrongKeyRejected = false;
    try { await importPushBundle(centralCtx, wrongKeyBytes); } catch (e) { wrongKeyRejected = e instanceof BundleSignatureError; }
    assert(wrongKeyRejected, 'push bundle re-signed with a throwaway key rejected with BundleSignatureError');

    // (c) Idempotent re-import of the GOOD bundle: applyRemote is monotonic → nothing re-applied.
    const reimp = await importPushBundle(centralCtx, pushBytes);
    assert(reimp.applied === 0, `re-import of the good push bundle applied 0 (idempotent; got ${reimp.applied})`);
    pass('(security) tamper + wrong-key rejected before any apply; good bundle re-import idempotent');

    // ── 6. PULL bundle round-trip (central → lab), incl. terminology. ──
    step('6. PULL bundle round-trip: central exports a signed reference+terminology bundle, lab imports it');
    // Central authors a managed dashboard (captured to reference_change_log by the dashboard store).
    await centralCtx.dashboards.store.create({
      id: dashId,
      ownerId: null,
      name: 'S5 Bundle Round-trip Dashboard',
      layout: [] as unknown[],
      widgets: [] as unknown[],
      filters: [] as unknown[],
      refreshIntervalSec: 0,
      isDefault: false,
    } as never);
    // Central authors a terminology system + concepts + a bulk change signal (mirrors an import).
    const centralFhir = createFhirStore(centralCtx.internalDb);
    const termStore = createTerminologyStore(centralCtx.internalDb, centralFhir);
    await termStore.saveSystem(SYS_URL, '1.0', 'CodeSystem', `${RUN_TAG}-cs`);
    await termStore.upsertConcepts(TERM_CONCEPTS.map((code, i) => ({ system: SYS_URL, code, display: `Concept ${i + 1}`, status: 'ACTIVE', properties: null })));
    await markTerminologyChanged(centralCtx.internalDb, SYS_URL);
    ok(`central authored dashboard '${dashId}' + terminology system '${SYS_URL}' (${TERM_CONCEPTS.length} concepts)`);

    const pullOut = join(outDir, 'pull.bundle');
    const { manifest: pullManifest } = await exportPullBundle(centralCtx, { siteId: SITE_ID, out: pullOut });
    // The bundle must carry BOTH the dashboard record AND the terminology_system record with its
    // concepts embedded in the body.
    const pullBytes = await readFile(pullOut);
    const pullUnpacked = unpackBundle(pullBytes);
    assert(pullUnpacked.records.kind === 'pull', 'pull bundle payload is a pull-kind record set');
    const pullRecs = pullUnpacked.records.records;
    const dashRec = pullRecs.find((r) => r.entityType === 'dashboard' && r.entityId === dashId);
    const termRec = pullRecs.find((r) => r.entityType === 'terminology_system' && r.entityId === SYS_URL);
    assert(!!dashRec, `pull bundle carries the dashboard reference record '${dashId}'`);
    assert(!!termRec, `pull bundle carries the terminology_system record '${SYS_URL}'`);
    const embedded = (termRec!.body as { concepts?: unknown[] } | null | undefined)?.concepts;
    assert(Array.isArray(embedded) && embedded.length === TERM_CONCEPTS.length, `terminology_system record embeds all ${TERM_CONCEPTS.length} concepts (got ${Array.isArray(embedded) ? embedded.length : 'none'})`);
    ok(`read ${pullBytes.length} pull bundle bytes (${pullRecs.length} records) from ${pullOut}`);

    const pullRes = await importPullBundle(labCtx, pullBytes);
    assert(pullRes.applied >= 2, `lab applied the dashboard + terminology records (got ${pullRes.applied})`);

    // Dashboard applied + stamped managed_origin=central.
    const labDash = await labCtx.internalDb.selectFrom('dashboards').selectAll().where('id', '=', dashId).executeTakeFirst();
    assert(!!labDash, `lab dashboards has '${dashId}' after pull import`);
    assert((labDash as { managed_origin?: string } | undefined)?.managed_origin === 'central', `lab dashboard stamped managed_origin='central'`);
    // Terminology concepts landed in the lab + the system row is stamped managed_origin=central. (The
    // terminology_concepts table has no managed_origin column of its own — the whole-system reconcile
    // stamps the SYSTEM row; concept membership is the per-row proof.)
    const labConceptCount = Number((await labCtx.internalDb.selectFrom('terminology_concepts').select((eb) => eb.fn.countAll().as('n')).where('system', '=', SYS_URL).executeTakeFirst())?.n ?? 0);
    assert(labConceptCount === TERM_CONCEPTS.length, `lab terminology_concepts has all ${TERM_CONCEPTS.length} concepts for the system (got ${labConceptCount})`);
    const labSys = await labCtx.internalDb.selectFrom('terminology_systems').selectAll().where('url', '=', SYS_URL).executeTakeFirst();
    assert((labSys as { managed_origin?: string } | undefined)?.managed_origin === 'central', `lab terminology_systems[${SYS_URL}] stamped managed_origin='central'`);
    pass('(pull) dashboard + whole terminology system (concepts embedded) applied on the lab, stamped central');

    // ── 7. Gap rejection: a pull bundle starting ahead of the lab's consumed cursor. ──
    step('7. gap rejection: a pull bundle whose fromCursor skips ahead of the lab sync-pull cursor');
    const labPullCursor = await readCursor(labCtx.internalDb, 'sync-pull');
    const { privHex: centralPriv } = await ensureCentralKeypair(centralCtx);
    const gapManifest: BundleManifest = {
      formatVersion: pullManifest.formatVersion,
      kind: 'pull',
      siteId: SITE_ID,
      fromCursor: labPullCursor + 100, // skip ahead of what the lab has consumed
      toCursor: labPullCursor + 200,
      recordCount: 0,
      signerKeyId: 'central',
      producedAt: new Date().toISOString(),
    };
    const gapBytes = signBundle(gapManifest, { kind: 'pull', records: [] }, centralPriv);
    let gapRejected = false;
    try { await importPullBundle(labCtx, gapBytes); } catch (e) { gapRejected = e instanceof BundleGapError; }
    assert(gapRejected, `pull bundle with fromCursor=${labPullCursor + 100} > lab cursor=${labPullCursor} rejected with BundleGapError`);
    pass('(gap) an out-of-order pull bundle is refused with a valid signature but a cursor gap');
  } catch (e) {
    if (failures === 0) failures++;
    console.error('\n[FAIL]', e instanceof Error ? e.stack : e);
  } finally {
    // ── 8. Cleanup: revoke the lab (delete the KC client), close both ctxs, drop the four DBs. ──
    step('8. cleanup');
    try { if (centralCtx && enrolled) await revokeSite(centralCtx, SITE_ID); } catch (e) { console.error('  [cleanup] revoke failed', e); }
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
    console.log('\n✅ sync:bundle:accept PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ sync:bundle:accept FAILED');
    process.exit(1);
  }
}

void main();
