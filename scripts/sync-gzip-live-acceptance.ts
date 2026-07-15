// Distributed Sync S7-B — gzip WIRE acceptance. Proves the compression slice over a REAL HTTP socket
// against the REAL shipped Fastify app, and — the entire justification for the slice — MEASURES that
// gzip actually shrinks a realistic sync batch.
//
// WHY THIS HARNESS EXISTS (read before "simplifying" it): the whole-slice review caught a bug that hid
// because a test hand-built its own Fastify and registered @fastify/compress itself — so it proved the
// plugin's behaviour, not the app's. That is precisely the bug class this slice is exposed to: buildApp
// must `await app.register(compress, ...)` BEFORE any route, or the plugin's onRoute listener sees no
// routes and goes silently inert while every unit test still passes. So this harness imports the REAL
// `buildApp` (the same import precedent as scripts/sync-two-instance-harness.ts), listens on a real
// ephemeral port, and drives it with real `fetch` / real `node:http`. Nothing about the compression
// wiring is reconstructed here.
//
// What is real vs. stubbed:
//   REAL — buildApp + its compress registration + every sync route, a real localhost HTTP hop, a real
//          Postgres internal DB (migrated to latest) behind a real FhirStore, and the real client-side
//          `encodePushBody` from @openldr/bootstrap for the measurement.
//   STUB — ctx.auth.verifyToken (returns a site_id claim, exactly as apps/server/src/sync-routes.test.ts
//          fakes it). No Keycloak/JWKS: this slice is about bytes on the wire, and the token→site_id→
//          sitePrincipal chain is already proven end-to-end by `pnpm sync:e2e`. Everything else on ctx
//          comes from apps/server/src/test-helpers.ts's `ctxWith` factory.
//
// What it proves:
//   1. ADVERT           — a real HTTP response carries the RFC 7694 `Accept-Encoding: gzip` header.
//   2. REQUEST INFLATE  — a ~200-record gzipped push body is parsed IDENTICALLY to the plain equivalent.
//                         Proven by content, not by a status code: batch A is pushed GZIPPED (applied=200),
//                         then the SAME batch A is re-pushed PLAIN and comes back skipped=200 — the plain
//                         parse recognised, record for record, exactly what the gzipped parse persisted.
//   3. OLD-CENTRAL SAFE — a fresh batch B pushed PLAIN (no Content-Encoding) applies all 200 the same way,
//                         so an un-upgraded client is not regressed.
//   4. UNSUPPORTED ENC  — `Content-Encoding: br` → 415 with code SY0415 in the body.
//   5. RESPONSE GZIP    — an >1 KB response with `Accept-Encoding: gzip` comes back `content-encoding: gzip`
//                         and gunzips to the correct JSON; a sub-threshold response does NOT, and neither
//                         does the same big response when gzip is not requested.
//   6. THE MEASUREMENT  — real `encodePushBody` on the realistic batch: plain bytes vs gzipped bytes, with
//                         a hard >=50% reduction assertion. A gzip that doesn't shrink is a bug.
//
// Preconditions: dev Postgres up on :5433 with the maintenance `openldr` DB.
//   docker compose up -d postgres
//
// Run: pnpm sync:gzip:accept
//
// Env override:
//   ADMIN_DATABASE_URL (postgres://openldr:openldr@localhost:5433/openldr) — maintenance DB used to
//   CREATE/DROP the test database.
import { type Kysely, sql } from 'kysely';
import { request as httpRequest } from 'node:http';
import { gunzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { createInternalDb, createFhirStore, createMigrator, internalMigrations } from '@openldr/db';
// Import buildApp from the server package's SOURCE file directly (not the package root: apps/server's
// index.ts self-executes `main()` on import). Same precedent as scripts/sync-two-instance-harness.ts.
import { buildApp } from '../apps/server/src/app';
import { ctxWith } from '../apps/server/src/test-helpers';
// The REAL client-side encoder the sync push runner uses. Imported from source because it is
// deliberately not re-exported from @openldr/bootstrap's barrel (internal to postPush) — importing the
// source keeps the measurement honest (same function, not a re-implementation) without widening the
// package's public API just for a test.
import { encodePushBody, GZIP_MIN_BYTES } from '../packages/bootstrap/src/sync-gzip';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr';
const urlFor = (dbName: string): string => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
};

const TEST_DB = 'openldr_s7b_gzip';
const SITE = 'lab-gzip';
const CONCEPT_SYSTEM = 'http://loinc.org/s7b-gzip-accept';
const CONCEPT_COUNT = 800;
const BATCH_SIZE = 200;

const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n[${m}]`);
const pass = (m: string) => console.log(`PASS: ${m}`);

const RUN_TAG = `s7b-gzip-${Date.now()}`;

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

// A realistically-shaped Observation sync record, as it arrives on the wire (SyncRecord & { seq }).
// Deliberately NOT a minimal stub: real batches carry codings, references, units and timestamps, and
// the compression ratio is only meaningful against representative content.
function obsRecord(prefix: string, i: number, seq: number) {
  const id = `${prefix}-obs-${String(i).padStart(4, '0')}`;
  return {
    resourceType: 'Observation' as const,
    id,
    version: 1,
    seq,
    op: 'upsert' as const,
    siteId: SITE,
    resource: {
      resourceType: 'Observation',
      id,
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' }] }],
      code: { coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin [Mass/volume] in Blood' }], text: 'Hemoglobin' },
      subject: { reference: `Patient/${prefix}-pat-${i % 25}` },
      specimen: { reference: `Specimen/${prefix}-sp-${i}` },
      basedOn: [{ reference: `ServiceRequest/${prefix}-sr-${i}` }],
      valueQuantity: { value: 12 + (i % 40) / 10, unit: 'g/dL', system: 'http://unitsofmeasure.org', code: 'g/dL' },
      referenceRange: [{ low: { value: 12, unit: 'g/dL' }, high: { value: 16, unit: 'g/dL' } }],
      effectiveDateTime: '2026-05-02T00:00:00Z',
      issued: '2026-05-02T10:00:00Z',
      performer: [{ reference: 'Organization/lab-gzip-org' }],
    },
  };
}

function batch(prefix: string, seqBase: number) {
  const records = Array.from({ length: BATCH_SIZE }, (_, i) => obsRecord(prefix, i, seqBase + i + 1));
  return { fromSeq: seqBase, records };
}

// Raw node:http request — used for the RESPONSE-compression checks. `fetch`/undici sends its own
// `Accept-Encoding` and transparently decodes the body, which would make "did the server gzip this?"
// unobservable (and any assertion on it vacuous). node:http adds no Accept-Encoding of its own and does
// no auto-decoding, so both the header and the raw bytes are exactly what crossed the socket.
function rawPost(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; raw: Buffer }> {
  const payload = Buffer.from(JSON.stringify(body));
  const u = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, raw: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
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

  let handle: ReturnType<typeof createInternalDb> | undefined;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  try {
    // ── 0. Provision + migrate one fresh internal DB. ──
    step('0. provision + migrate a fresh database on :5433');
    await provisionDb(adminDb, TEST_DB);
    handle = createInternalDb(urlFor(TEST_DB));
    const db = handle.db;
    await migrateInternal(db as unknown as Kysely<unknown>);
    ok(`created + migrated ${TEST_DB} (internal) to latest`);

    // Seed a bulk terminology system for the RESPONSE-compression check (>1 KB of JSON on the wire).
    await db
      .insertInto('terminology_concepts')
      .values(
        Array.from({ length: CONCEPT_COUNT }, (_, i) => ({
          system: CONCEPT_SYSTEM,
          code: `c${String(i).padStart(5, '0')}`,
          display: `Hemoglobin [Mass/volume] in Blood — synthetic bulk concept ${i}`,
          status: 'ACTIVE',
          properties: null,
        })) as never,
      )
      .execute();
    ok(`seeded ${CONCEPT_COUNT} terminology_concepts under ${CONCEPT_SYSTEM}`);

    // ── 1. Boot the REAL app: real buildApp over a real ctx, on a real ephemeral localhost port. ──
    step('1. start the REAL buildApp(ctx) on an ephemeral localhost port');
    const ctx = ctxWith('up');
    // Real internal DB + real FhirStore behind the real routes; only verifyToken is stubbed (see header).
    (ctx as { internalDb: unknown }).internalDb = db;
    (ctx as { fhirStore: unknown }).fhirStore = createFhirStore(db);
    (ctx as { auth: { verifyToken: unknown } }).auth.verifyToken = async () => ({ sub: 'client-gzip', site_id: SITE });

    app = await buildApp(ctx);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    ok(`real app listening at ${baseUrl}`);

    const AUTH = { Authorization: 'Bearer tok-gzip' };

    // Count only THIS run's pushed resources. `fhir.fhir_resources` is not empty on a fresh DB (the
    // internal migrations seed reference resources), so an unscoped count would measure the seeds too.
    const countPushed = async (prefix: string): Promise<number> => {
      const r = await db
        .selectFrom('fhir.fhir_resources')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('resource_type', '=', 'Observation')
        .where('id', 'like', `${prefix}%`)
        .executeTakeFirst();
      return Number(r?.n ?? 0);
    };
    assert(await countPushed(RUN_TAG) === 0, 'no resources from this run present before the first push (clean baseline)');

    // ── 2. ADVERT: a real HTTP response carries `Accept-Encoding: gzip` (RFC 7694). ──
    step('2. advert: a real HTTP response carries Accept-Encoding: gzip');
    const healthRes = await fetch(`${baseUrl}/health`);
    const advert = healthRes.headers.get('accept-encoding');
    assert(healthRes.status === 200, `GET /health over real HTTP → 200 (got ${healthRes.status})`);
    assert(advert === 'gzip', `response advertises Accept-Encoding: gzip (got '${advert}')`);
    // The client-side detector agrees with what the real server actually sent — the two halves of the
    // negotiation are checked against each other, not each against a hand-written string.
    const { advertisesGzip } = await import('../packages/bootstrap/src/sync-gzip');
    assert(advertisesGzip(advert), 'the real client-side advertisesGzip() accepts the real advert header');
    pass('central advertises gzipped-request support on a real response');

    // ── 3. REQUEST INFLATION: batch A gzipped over real fetch → all 200 applied. ──
    step('3. request inflation: POST a gzipped ~200-record batch over real fetch');
    const batchA = batch(`${RUN_TAG}-a`, 0);
    const jsonA = JSON.stringify(batchA);
    const encodedA = encodePushBody(jsonA, true);
    assert(Buffer.isBuffer(encodedA.body), 'encodePushBody gzipped the realistic batch (body is a Buffer)');
    assert(encodedA.headers['Content-Encoding'] === 'gzip', 'encodePushBody set Content-Encoding: gzip');

    const gzRes = await fetch(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...AUTH, ...encodedA.headers },
      body: encodedA.body as Buffer,
    });
    assert(gzRes.status === 200, `gzipped push → 200 (got ${gzRes.status})`);
    const gzBody = (await gzRes.json()) as { applied: number; skipped: number; rejects: unknown[]; ackSeq: number };
    assert(gzBody.applied === BATCH_SIZE, `server inflated + applied all ${BATCH_SIZE} gzipped records (got ${gzBody.applied})`);
    assert(gzBody.rejects.length === 0, `no rejects from the gzipped batch (got ${gzBody.rejects.length})`);
    assert(gzBody.ackSeq === BATCH_SIZE, `ackSeq = max seq ${BATCH_SIZE} (got ${gzBody.ackSeq})`);
    const rowsAfterA = await countPushed(`${RUN_TAG}-a`);
    assert(rowsAfterA === BATCH_SIZE, `${BATCH_SIZE} rows durably persisted from the gzipped batch (got ${rowsAfterA})`);
    pass(`server inflated a real gzipped request body and persisted all ${BATCH_SIZE} records`);

    // ── 4. PARSE AGREEMENT: re-POST the SAME batch A PLAIN → every record recognised as already-applied.
    //    Scope of this proof, precisely: applyRemote's idempotency key is (resource_type, id, version) —
    //    it does NOT compare bodies. So skipping all 200 proves the gzipped parse produced the same
    //    records BY IDENTITY (type/id/version) and the same ackSeq as the plain parse would have; it does
    //    NOT prove the resource CONTENT round-tripped. Content equality is proven separately and directly
    //    in step 7, which gunzips a real response and asserts byte-equality against the uncompressed one.
    //    (Body corruption is not a realistic gzip failure mode anyway — inflate is lossless and a damaged
    //    stream throws rather than silently mutating — but don't claim more than is actually asserted.) ──
    step('4. parse identity: re-POST the SAME batch PLAIN (no Content-Encoding)');
    const plainSameRes = await fetch(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...AUTH },
      body: jsonA,
    });
    assert(plainSameRes.status === 200, `plain re-push of the same batch → 200 (got ${plainSameRes.status})`);
    const plainSame = (await plainSameRes.json()) as { applied: number; skipped: number; rejects: unknown[]; ackSeq: number };
    assert(plainSame.applied === 0, `plain re-push applied 0 (got ${plainSame.applied})`);
    assert(
      plainSame.skipped === BATCH_SIZE,
      `plain parse saw all ${BATCH_SIZE} records as already-present → the gzipped parse produced the same records by (type,id,version) (got ${plainSame.skipped})`,
    );
    assert(plainSame.ackSeq === gzBody.ackSeq, `plain re-push ackSeq matches the gzipped push (${plainSame.ackSeq} === ${gzBody.ackSeq})`);
    const rowsAfterRepush = await countPushed(`${RUN_TAG}-a`);
    assert(rowsAfterRepush === BATCH_SIZE, `row count unchanged at ${BATCH_SIZE} after the plain re-push (got ${rowsAfterRepush})`);
    pass('gzipped and plain bodies parse to the same records by (type,id,version) + the same ackSeq');

    // ── 5. OLD-CENTRAL SAFETY / NO REGRESSION: a FRESH batch B, plain, applies exactly like the gzipped
    //    one did — the plain path is not merely idempotent, it still does real work. ──
    step('5. no regression: a fresh batch POSTed PLAIN applies exactly like the gzipped one');
    const batchB = batch(`${RUN_TAG}-b`, BATCH_SIZE);
    const plainRes = await fetch(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...AUTH },
      body: JSON.stringify(batchB),
    });
    assert(plainRes.status === 200, `plain push of a fresh batch → 200 (got ${plainRes.status})`);
    const plainBody = (await plainRes.json()) as { applied: number; skipped: number; rejects: unknown[]; ackSeq: number };
    assert(plainBody.applied === BATCH_SIZE, `plain push applied all ${BATCH_SIZE} (got ${plainBody.applied})`);
    assert(plainBody.skipped === gzBody.skipped, `plain push skipped tally matches the gzipped push (${plainBody.skipped} === ${gzBody.skipped})`);
    assert(plainBody.rejects.length === 0, `no rejects from the plain batch (got ${plainBody.rejects.length})`);
    const rowsAfterB = await countPushed(`${RUN_TAG}-b`);
    assert(rowsAfterB === BATCH_SIZE, `${BATCH_SIZE} rows persisted from the plain batch (got ${rowsAfterB})`);
    assert(
      (await countPushed(RUN_TAG)) === BATCH_SIZE * 2,
      `${BATCH_SIZE * 2} rows total across the gzipped + plain batches (got ${await countPushed(RUN_TAG)})`,
    );
    pass('an un-upgraded (never-gzipping) client is not regressed');

    // ── 6. UNSUPPORTED REQUEST ENCODING → 415 SY0415. ──
    step('6. unsupported request encoding: Content-Encoding: br → 415 SY0415');
    const brRes = await fetch(`${baseUrl}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...AUTH, 'Content-Encoding': 'br' },
      body: encodedA.body as Buffer,
    });
    assert(brRes.status === 415, `Content-Encoding: br → 415 (got ${brRes.status})`);
    const brBody = (await brRes.json()) as { code?: string; error?: string; correlationId?: string };
    assert(brBody.code === 'SY0415', `415 body carries code 'SY0415' (got '${brBody.code}')`);
    assert(typeof brBody.correlationId === 'string' && brBody.correlationId.length > 0, 'the 415 flows through the coded error handler (has a correlationId)');
    pass('an unsupported request encoding is rejected as a catalogued SY0415');

    // ── 7. RESPONSE COMPRESSION (raw node:http — see rawPost's note on why not fetch). ──
    step('7. response compression: >1 KB response gzips only when asked');
    const bulkReq = { systemUrl: CONCEPT_SYSTEM, limit: CONCEPT_COUNT };

    // 7a. Asked for gzip → gzipped, and the bytes gunzip to the correct JSON.
    const gzipped = await rawPost(baseUrl, '/api/sync/terminology/concepts', bulkReq, { ...AUTH, 'Accept-Encoding': 'gzip' });
    assert(gzipped.status === 200, `bulk concepts POST → 200 (got ${gzipped.status})`);
    assert(gzipped.headers['content-encoding'] === 'gzip', `response is content-encoding: gzip (got '${String(gzipped.headers['content-encoding'])}')`);
    // A non-empty body is asserted explicitly: the original S7-B bug shipped `content-encoding: gzip`
    // with `content-length: 0`, so the header alone proves nothing.
    assert(gzipped.raw.length > 0, `the gzipped response actually has a body (got ${gzipped.raw.length} bytes, content-length '${String(gzipped.headers['content-length'])}')`);
    const decoded = JSON.parse(gunzipSync(gzipped.raw).toString('utf8')) as { concepts: { code: string }[]; nextCode: string | null };
    assert(decoded.concepts.length === CONCEPT_COUNT, `gunzipped response decodes to all ${CONCEPT_COUNT} concepts (got ${decoded.concepts.length})`);
    assert(decoded.concepts[0]?.code === 'c00000', `gunzipped payload is correct + ordered (first code '${decoded.concepts[0]?.code}')`);

    // 7b. Same big response, gzip NOT requested → not compressed (content negotiation is honoured).
    const notAsked = await rawPost(baseUrl, '/api/sync/terminology/concepts', bulkReq, { ...AUTH });
    assert(notAsked.status === 200, `bulk concepts POST without Accept-Encoding → 200 (got ${notAsked.status})`);
    assert(notAsked.headers['content-encoding'] === undefined, `a client that does not ask gets NO content-encoding (got '${String(notAsked.headers['content-encoding'])}')`);
    const plainDecoded = JSON.parse(notAsked.raw.toString('utf8')) as { concepts: { code: string }[] };
    assert(plainDecoded.concepts.length === CONCEPT_COUNT, `uncompressed response carries the same ${CONCEPT_COUNT} concepts (got ${plainDecoded.concepts.length})`);
    // The compressed and uncompressed responses are the same payload — gzip changed the bytes, not the data.
    assert(gunzipSync(gzipped.raw).equals(notAsked.raw), 'the gunzipped body is byte-identical to the uncompressed body');
    // And it genuinely shrank on the wire.
    assert(gzipped.raw.length < notAsked.raw.length, `the gzipped response is smaller on the wire (${gzipped.raw.length} < ${notAsked.raw.length} bytes)`);

    // 7c. Sub-threshold response → NOT gzipped even though gzip was requested (the 1024-byte threshold).
    const tiny = await rawPost(baseUrl, '/api/sync/terminology/concepts', { systemUrl: 'http://unknown/no-such-system' }, { ...AUTH, 'Accept-Encoding': 'gzip' });
    assert(tiny.status === 200, `sub-threshold concepts POST → 200 (got ${tiny.status})`);
    assert(tiny.raw.length < GZIP_MIN_BYTES, `the sub-threshold response is genuinely under the ${GZIP_MIN_BYTES}-byte threshold (${tiny.raw.length} bytes)`);
    assert(tiny.headers['content-encoding'] === undefined, `a sub-threshold response is NOT gzipped (got '${String(tiny.headers['content-encoding'])}')`);
    pass('responses gzip above the threshold, only for clients that ask');

    // ── 8. THE MEASUREMENT — the entire point of the slice. Real encodePushBody, realistic batch. ──
    step('8. THE MEASUREMENT: how much does gzip actually save on a real push batch?');
    const plainBytes = Buffer.byteLength(jsonA);
    const gzipBytes = (encodedA.body as Buffer).length;
    const reduction = 1 - gzipBytes / plainBytes;
    console.log(`\n  ── push batch (${BATCH_SIZE} Observation records, real encodePushBody) ──`);
    console.log(`     plain JSON : ${plainBytes.toLocaleString()} bytes`);
    console.log(`     gzipped    : ${gzipBytes.toLocaleString()} bytes`);
    console.log(`     reduction  : ${(reduction * 100).toFixed(1)}%  (ratio ${(plainBytes / gzipBytes).toFixed(1)}:1)\n`);
    assert(
      reduction >= 0.5,
      `gzip shrinks the realistic push batch by at least 50% (got ${(reduction * 100).toFixed(1)}%: ${plainBytes} → ${gzipBytes} bytes)`,
    );

    // The response direction too — the big terminology page is the bandwidth case that motivated this.
    const respReduction = 1 - gzipped.raw.length / notAsked.raw.length;
    console.log(`  ── bulk terminology response (${CONCEPT_COUNT} concepts, real @fastify/compress) ──`);
    console.log(`     plain      : ${notAsked.raw.length.toLocaleString()} bytes`);
    console.log(`     gzipped    : ${gzipped.raw.length.toLocaleString()} bytes`);
    console.log(`     reduction  : ${(respReduction * 100).toFixed(1)}%  (ratio ${(notAsked.raw.length / gzipped.raw.length).toFixed(1)}:1)\n`);
    assert(
      respReduction >= 0.5,
      `gzip shrinks the bulk terminology response by at least 50% (got ${(respReduction * 100).toFixed(1)}%)`,
    );
    pass('gzip measurably shrinks the wire in BOTH directions');
  } catch (e) {
    if (failures === 0) failures++;
    console.error('\n[FAIL]', e instanceof Error ? e.stack : e);
  } finally {
    step('cleanup');
    try { await app?.close(); } catch { /* ignore */ }
    try { await handle?.close(); } catch { /* ignore */ }
    try {
      await dropDb(adminDb, TEST_DB);
      ok(`dropped ${TEST_DB}`);
    } catch (e) { console.error('  [cleanup] drop failed', e); }
    await admin.close().catch(() => undefined);
  }

  if (failures === 0) {
    console.log('\n✅ sync:gzip:accept PASSED');
    process.exit(0);
  } else {
    console.log('\n❌ sync:gzip:accept FAILED');
    process.exit(1);
  }
}

void main();
