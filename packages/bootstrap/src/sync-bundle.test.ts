import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { generatePublisherKeypair, signManifest } from '@openldr/marketplace';
import { packBundle, unpackBundle, type BundleManifest, type BundleRecords } from '@openldr/sync';
// A real migrated pg-mem internal DB — imported from a DIFFERENT subpath than the mocked '@openldr/db'
// below, so the terminology reconcile (createTerminologyBulkSync, NOT mocked) runs its real SQL.
import { makeMigratedDb } from '@openldr/db/testing';

// The orchestrations write the bundle to disk via node:fs/promises writeFile. Mock the module so the
// test captures the bytes without touching the filesystem (ESM namespace exports can't be re-spied).
vi.mock('node:fs/promises', () => ({ writeFile: vi.fn(async () => {}) }));
import { writeFile } from 'node:fs/promises';
/** Bytes handed to the most recent writeFile call. */
function lastBytes(): Buffer {
  const calls = (writeFile as unknown as Mock).mock.calls;
  return calls[calls.length - 1][1] as Buffer;
}

// The push safe-frontier (fetchSafeChangeRows) needs Postgres xmin/snapshot functions that pg-mem
// cannot run — the whole @openldr/sync package tests this path via injected fakes, never a real DB.
// So we follow that pattern here: partially mock @openldr/db (keep planProjection real; fake the
// cursor + safe-frontier + reference-applier DB primitives over shared in-memory state), and drive
// the orchestrations with a hand-rolled fake AppContext.
const H = vi.hoisted(() => ({
  cursors: {} as Record<string, number>,
  changeRows: [] as { seq: number; version: number; site_id: string | null; resource_type: string; resource_id: string; op: string }[],
  boundary: 1_000_000,
  xmax: 1_000_000,
  pageSize: 1_000_000, // how many rows the faked safe-frontier returns per page (drain paging)
  appliedRef: [] as { entityType: string; entityId: string; op: string }[],
}));

vi.mock('@openldr/db', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    readCursor: async (_db: unknown, consumer: string) => H.cursors[consumer] ?? 0,
    advanceCursor: async (_db: unknown, consumer: string, seq: number) => {
      H.cursors[consumer] = seq;
    },
    // Canned SafeFetchResult from the shared change rows (all committed: xid=1 < boundary). Mirrors
    // what fetchSafeChangeRows returns from real PG, so collectPushRecords genuinely drives planProjection.
    fetchSafeChangeRows: async (_db: unknown, cursor: number) => ({
      rows: H.changeRows
        .filter((r) => r.seq > cursor)
        .slice(0, H.pageSize) // emulate the safe-frontier's batchSize page so a drain loop is exercised
        .map((r) => ({ seq: r.seq, xid: 1, resource_type: r.resource_type, resource_id: r.resource_id, op: r.op })),
      boundary: H.boundary,
      xmax: H.xmax,
    }),
    createReferenceApplier: () => async (rec: { entityType: string; entityId: string; op: string }) => {
      H.appliedRef.push({ entityType: rec.entityType, entityId: rec.entityId, op: rec.op });
      return 'applied' as const;
    },
  };
});

// Static imports still receive the mock — vi.mock is hoisted above all imports.
import {
  exportPushBundle,
  importPushBundle,
  exportPullBundle,
  importPullBundle,
  BundleSignatureError,
  BundleGapError,
} from './sync-bundle';
import { SiteNotFoundError } from './enrollment';

// --- fakes ---------------------------------------------------------------------------------------

function cmp(a: unknown, b: unknown): number {
  const na = Number(a);
  const nb = Number(b);
  if (a != null && b != null && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

// Minimal read-only chainable over seeded tables (only SELECT paths are exercised — the cursor,
// frontier, and reference writes are all mocked at the @openldr/db boundary).
function fakeInternalDb(tables: Record<string, Record<string, unknown>[]>) {
  return {
    selectFrom(table: string) {
      let rows = [...(tables[table] ?? [])];
      const orderKeys: string[] = [];
      let lim = Infinity;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        selectAll: () => b,
        where(col: string, op: string, val: unknown) {
          rows = rows.filter((r) => {
            const v = r[col];
            if (op === '>') return cmp(v, val) > 0;
            if (op === '<=') return cmp(v, val) <= 0;
            if (op === '=') return v === val;
            return true;
          });
          return b;
        },
        orderBy(col: string) {
          orderKeys.push(col);
          return b;
        },
        limit(n: number) {
          lim = n;
          return b;
        },
        materialize() {
          let out = rows;
          if (orderKeys.length) out = [...rows].sort((x, y) => { for (const k of orderKeys) { const d = cmp(x[k], y[k]); if (d) return d; } return 0; });
          return out.slice(0, lim);
        },
        async execute() {
          return (b.materialize as () => unknown[])();
        },
        async executeTakeFirst() {
          return (b.materialize as () => unknown[])()[0];
        },
      });
      return b;
    },
  };
}

function fakeAppSettings(initial: Record<string, string> = {}) {
  const m = new Map<string, string>(Object.entries(initial));
  return {
    async get(k: string) {
      return m.has(k) ? { value: m.get(k)! } : null;
    },
    async set(k: string, v: string) {
      m.set(k, v);
    },
    _map: m,
  };
}

function fakeSyncSites() {
  const rows = new Map<string, { siteId: string; status: 'active' | 'revoked'; signingPublicKey: string | null; reportedPullCursor: number }>();
  return {
    _rows: rows,
    async get(siteId: string) {
      return rows.get(siteId);
    },
    async getReportedPullCursor(siteId: string) {
      return rows.get(siteId)?.reportedPullCursor ?? 0;
    },
    async setReportedPullCursor(siteId: string, seq: number) {
      const r = rows.get(siteId);
      if (r) r.reportedPullCursor = seq;
    },
  };
}

// applyRemote: monotonic by (resourceType/id) version — idempotent re-apply returns 'skipped'.
function fakeFhirStore() {
  const versions = new Map<string, number>();
  const applied: { id: string; version: number; seq: number; siteId: string }[] = [];
  return {
    _applied: applied,
    async applyRemote(rec: { resourceType: string; id: string; version: number; seq: number; siteId: string }) {
      const key = `${rec.resourceType}/${rec.id}`;
      const cur = versions.get(key) ?? -1;
      if (rec.version <= cur) return 'skipped' as const;
      versions.set(key, rec.version);
      applied.push({ id: rec.id, version: rec.version, seq: rec.seq, siteId: rec.siteId });
      return 'applied' as const;
    },
  };
}

const idIdentity = (s: string) => s; // encrypt/decrypt = identity for the test

function makeCtx(over: Partial<Record<string, unknown>> = {}) {
  const ctx = {
    logger: { warn() {}, error() {}, info() {}, debug() {} },
    appSettings: fakeAppSettings(),
    syncSites: fakeSyncSites(),
    fhirStore: fakeFhirStore(),
    internalDb: fakeInternalDb({}),
    dashboards: { store: { get: async () => undefined } },
    reportDefs: { get: async () => undefined },
    encryptSecret: idIdentity,
    decryptSecret: idIdentity,
    ...over,
  };
  return ctx as unknown as import('./index').AppContext & typeof ctx;
}

// Mirror sync-bundle's private signBundleBytes so a test can forge a bundle (e.g. a cross-site record).
function signBundle(manifest: BundleManifest, records: BundleRecords, privHex: string): Buffer {
  const base: BundleManifest = { ...manifest };
  delete base.signature;
  const { payloadSha256 } = packBundle(base, records);
  const signature = signManifest(base as unknown as Record<string, unknown>, payloadSha256, Buffer.from(privHex, 'hex'));
  return packBundle({ ...base, signature }, records).bytes;
}

function hexKeys() {
  const kp = generatePublisherKeypair();
  return { pub: Buffer.from(kp.publicKeyDer).toString('hex'), priv: Buffer.from(kp.privateKeyDer).toString('hex') };
}

beforeEach(() => {
  H.cursors = {};
  H.changeRows = [];
  H.appliedRef = [];
  H.boundary = 1_000_000;
  H.xmax = 1_000_000;
  H.pageSize = 1_000_000;
  (writeFile as unknown as Mock).mockClear();
});

// --- PUSH ----------------------------------------------------------------------------------------

describe('exportPushBundle / importPushBundle', () => {
  const SITE = 'lab-a';

  function seedPushCtx() {
    const site = hexKeys();
    H.changeRows = [
      { seq: 1, version: 5, site_id: SITE, resource_type: 'Patient', resource_id: 'p1', op: 'upsert' },
      { seq: 2, version: 6, site_id: SITE, resource_type: 'Patient', resource_id: 'p2', op: 'delete' },
    ];
    const ctx = makeCtx({
      appSettings: fakeAppSettings({ 'sync.site_id': SITE, 'sync.signing_private_key': site.priv }),
      internalDb: fakeInternalDb({
        'fhir.change_log': H.changeRows,
        'fhir.resource_history': [{ resource_type: 'Patient', id: 'p1', version: 5, resource: { resourceType: 'Patient', id: 'p1' } }],
      }),
    });
    ctx.syncSites._rows.set(SITE, { siteId: SITE, status: 'active', signingPublicKey: site.pub, reportedPullCursor: 0 });
    return { ctx, site };
  }

  it('exports a signed push bundle that verifies with the site key; manifest range + pullCursor correct; advances sync-push', async () => {
    const { ctx } = seedPushCtx();
    H.cursors['sync-pull'] = 7; // lab has consumed reference up to 7 → piggybacked

    const { manifest, path } = await exportPushBundle(ctx, {});
    expect(path).toBe(`sync-push-${SITE}-0-2.bundle`);
    expect(manifest).toMatchObject({ kind: 'push', siteId: SITE, fromCursor: 0, toCursor: 2, recordCount: 2, signerKeyId: SITE, pullCursor: 7 });
    // The signature is embedded in the WRITTEN bytes (the returned manifest is the pre-sign header).
    const written = unpackBundle(lastBytes());
    expect(typeof written.manifest.signature).toBe('string');
    expect(written.records.records).toHaveLength(2);
    // Default export advances the sync-push cursor.
    expect(H.cursors['sync-push']).toBe(2);
  });

  it('does NOT advance sync-push when an explicit --from is given (read-only re-export)', async () => {
    const { ctx } = seedPushCtx();
    await exportPushBundle(ctx, { from: 0 });
    expect(H.cursors['sync-push']).toBeUndefined(); // never touched
  });

  it('DRAINS the full frontier across multiple pages into ONE bundle; cursor advances to the end', async () => {
    const site = hexKeys();
    // 5 committed changes, but the faked safe-frontier only serves 2 rows per page → 3 pages to drain.
    H.changeRows = Array.from({ length: 5 }, (_, i) => ({
      seq: i + 1, version: i + 1, site_id: SITE, resource_type: 'Patient', resource_id: `p${i + 1}`, op: 'upsert',
    }));
    H.pageSize = 2;
    const ctx = makeCtx({
      appSettings: fakeAppSettings({ 'sync.site_id': SITE, 'sync.signing_private_key': site.priv }),
      internalDb: fakeInternalDb({
        'fhir.change_log': H.changeRows,
        'fhir.resource_history': H.changeRows.map((r) => ({
          resource_type: 'Patient', id: r.resource_id, version: r.version, resource: { resourceType: 'Patient', id: r.resource_id },
        })),
      }),
    });
    ctx.syncSites._rows.set(SITE, { siteId: SITE, status: 'active', signingPublicKey: site.pub, reportedPullCursor: 0 });

    const { manifest } = await exportPushBundle(ctx, {});
    // The bundle carries ALL 5 records (not just the first 2-row page) and spans the full range.
    expect(manifest).toMatchObject({ fromCursor: 0, toCursor: 5, recordCount: 5 });
    const written = unpackBundle(lastBytes());
    expect(written.records.records.map((r) => (r as { id: string }).id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    // Cursor advanced to the end of the drained frontier.
    expect(H.cursors['sync-push']).toBe(5);
  });

  it('round-trips: import applies the records, records the piggybacked pull cursor, and is idempotent', async () => {
    const { ctx } = seedPushCtx();
    H.cursors['sync-pull'] = 4;
    // capture the bytes the exporter wrote
    await exportPushBundle(ctx, {});
    const bytes = lastBytes();

    const res = await importPushBundle(ctx, bytes);
    expect(res).toEqual({ applied: 2, ackSeq: 2, siteId: SITE });
    expect(ctx.fhirStore._applied.map((r) => r.id)).toEqual(['p1', 'p2']);
    expect(ctx.syncSites._rows.get(SITE)!.reportedPullCursor).toBe(4);

    // Re-import: applyRemote reports skipped for all → applied 0 (idempotent).
    const again = await importPushBundle(ctx, bytes);
    expect(again.applied).toBe(0);
  });

  it('rejects a bundle signed with the WRONG key (BundleSignatureError, nothing applied)', async () => {
    const { ctx } = seedPushCtx();
    await exportPushBundle(ctx, {});
    const bytes = lastBytes();
    // Swap the stored site public key to an unrelated one.
    ctx.syncSites._rows.get(SITE)!.signingPublicKey = hexKeys().pub;
    await expect(importPushBundle(ctx, bytes)).rejects.toBeInstanceOf(BundleSignatureError);
    expect(ctx.fhirStore._applied).toHaveLength(0);
  });

  it('rejects a tampered payload (BundleSignatureError)', async () => {
    const { ctx } = seedPushCtx();
    await exportPushBundle(ctx, {});
    const bytes = lastBytes();
    // Re-pack with a mutated record but the ORIGINAL signature → payload sha changes → verify fails.
    const { manifest, records } = unpackBundle(bytes);
    (records.records[0] as { id: string }).id = 'HACKED';
    const tampered = packBundle(manifest, records).bytes;
    await expect(importPushBundle(ctx, tampered)).rejects.toBeInstanceOf(BundleSignatureError);
  });

  it('rejects an unknown or revoked site (SiteNotFoundError, before any verify/apply)', async () => {
    const { ctx } = seedPushCtx();
    await exportPushBundle(ctx, {});
    const bytes = lastBytes();

    ctx.syncSites._rows.delete(SITE);
    await expect(importPushBundle(ctx, bytes)).rejects.toBeInstanceOf(SiteNotFoundError);

    // Revoked site is also rejected.
    ctx.syncSites._rows.set(SITE, { siteId: SITE, status: 'revoked', signingPublicKey: hexKeys().pub, reportedPullCursor: 0 });
    await expect(importPushBundle(ctx, bytes)).rejects.toBeInstanceOf(SiteNotFoundError);
  });

  it('skips a cross-site record (rec.siteId != manifest.siteId) without applying it', async () => {
    const site = hexKeys();
    const ctx = makeCtx();
    ctx.syncSites._rows.set(SITE, { siteId: SITE, status: 'active', signingPublicKey: site.pub, reportedPullCursor: 0 });
    const manifest: BundleManifest = {
      formatVersion: 1, kind: 'push', siteId: SITE, fromCursor: 0, toCursor: 2, recordCount: 2,
      signerKeyId: SITE, producedAt: new Date().toISOString(), pullCursor: 0,
    };
    const records: BundleRecords = {
      kind: 'push',
      records: [
        { resourceType: 'Patient', id: 'ok', version: 1, op: 'upsert', siteId: SITE, seq: 1, resource: { resourceType: 'Patient', id: 'ok' } },
        { resourceType: 'Patient', id: 'evil', version: 1, op: 'upsert', siteId: 'lab-b', seq: 2, resource: { resourceType: 'Patient', id: 'evil' } },
      ],
    };
    const bytes = signBundle(manifest, records, site.priv);
    const res = await importPushBundle(ctx, bytes);
    expect(res.applied).toBe(1);
    expect(ctx.fhirStore._applied.map((r) => r.id)).toEqual(['ok']); // 'evil' never applied
  });
});

// --- PULL (reference-config) ---------------------------------------------------------------------

describe('exportPullBundle / importPullBundle', () => {
  const SITE = 'lab-a';
  // A non-migration-seeded system/map URL so no pre-seeded terminology collides with our assertions.
  const SYS = 'http://example.org/CodeSystem/central';
  const MAP = 'http://example.org/ConceptMap/central';

  // Fake-DB ctx for the pure export / signature / gap paths (no terminology reconcile is exercised).
  function seedPullCtx(reportedCursor = 0, concepts: { code: string; display: string | null; status: string | null; properties: unknown }[] = []) {
    const ctx = makeCtx({
      appSettings: fakeAppSettings(),
      internalDb: fakeInternalDb({
        reference_change_log: [
          { seq: 1, entity_type: 'setting', entity_id: 's1', op: 'upsert', content_hash: 'h' },
          { seq: 2, entity_type: 'terminology_system', entity_id: SYS, op: 'upsert', content_hash: 'hg' },
        ],
        terminology_systems: [{ url: SYS, version: '2.77', kind: 'CodeSystem', resource_id: 'cs', generation: '4' }],
        terminology_concepts: concepts.map((c) => ({ system: SYS, ...c })),
      }),
    });
    // setting body is served from appSettings.get
    (ctx.appSettings as ReturnType<typeof fakeAppSettings>)._map.set('s1', 'on');
    ctx.syncSites._rows.set(SITE, { siteId: SITE, status: 'active', signingPublicKey: null, reportedPullCursor: reportedCursor });
    return ctx;
  }

  it('exports a signed pull bundle from cursor 0, EMBEDDING the terminology system\'s concepts in the record body', async () => {
    const ctx = seedPullCtx(0, [
      { code: 'A', display: 'Alpha', status: 'active', properties: { a: 1 } },
      { code: 'B', display: 'Bravo', status: 'active', properties: null },
    ]);
    const { manifest } = await exportPullBundle(ctx, { siteId: SITE });
    // servePull returns setting(1) + terminology_system(2); BOTH are now carried (terminology no longer filtered).
    expect(manifest).toMatchObject({ kind: 'pull', siteId: SITE, fromCursor: 0, toCursor: 2, recordCount: 2, signerKeyId: 'central' });

    const { records } = unpackBundle(lastBytes());
    const types = records.records.map((r) => (r as { entityType: string }).entityType);
    expect(types).toEqual(['setting', 'terminology_system']);
    // The terminology record's body carries the DRAINED concepts (descriptor fields preserved alongside).
    const term = records.records.find((r) => (r as { entityType: string }).entityType === 'terminology_system') as { body: { concepts: { code: string }[]; version?: string } };
    expect(term.body.concepts.map((c) => c.code)).toEqual(['A', 'B']);
    expect(term.body.version).toBe('2.77'); // servePull descriptor still present
  });

  it('exports a signed pull bundle EMBEDDING a concept_map\'s elements in the record body (drainMapElements)', async () => {
    const ctx = makeCtx({
      appSettings: fakeAppSettings(),
      internalDb: fakeInternalDb({
        reference_change_log: [{ seq: 1, entity_type: 'concept_map', entity_id: MAP, op: 'upsert', content_hash: 'hm' }],
        concept_map_state: [{ map_url: MAP, generation: '2' }],
        concept_map_elements: [
          { map_url: MAP, source_system: 'http://a', source_code: 'a1', target_system: 'http://b', target_code: 'b1', equivalence: 'equivalent' },
          { map_url: MAP, source_system: 'http://a', source_code: 'a2', target_system: 'http://b', target_code: 'b2', equivalence: 'related-to' },
        ],
      }),
    });
    ctx.syncSites._rows.set(SITE, { siteId: SITE, status: 'active', signingPublicKey: null, reportedPullCursor: 0 });

    const { manifest } = await exportPullBundle(ctx, { siteId: SITE });
    expect(manifest).toMatchObject({ kind: 'pull', siteId: SITE, fromCursor: 0, toCursor: 1, recordCount: 1, signerKeyId: 'central' });

    const { records } = unpackBundle(lastBytes());
    expect(records.records.map((r) => (r as { entityType: string }).entityType)).toEqual(['concept_map']);
    const map = records.records[0] as { body: { elements: { sourceCode: string; targetCode: string }[]; mapUrl?: string; generation?: number } };
    // Elements DRAINED via serveMapElementsPage/drainMapElements, with the servePull descriptor preserved.
    expect(map.body.elements.map((e) => e.sourceCode)).toEqual(['a1', 'a2']);
    expect(map.body.elements.map((e) => e.targetCode)).toEqual(['b1', 'b2']);
    expect(map.body.mapUrl).toBe(MAP);
    expect(map.body.generation).toBe(2);
  });

  it('round-trips: lab verifies with the pinned central key, applies the setting AND reconciles the embedded terminology system, advances sync-pull', async () => {
    const labDb = await makeMigratedDb();
    const kp = hexKeys();
    const ctx = makeCtx({
      appSettings: fakeAppSettings({ 'sync.central_public_key': kp.pub }),
      internalDb: labDb,
    });

    // A signed pull bundle carrying a reference (setting) record + a terminology_system upsert whose
    // body embeds the concepts (exactly what exportPullBundle produces).
    const manifest: BundleManifest = {
      formatVersion: 1, kind: 'pull', siteId: SITE, fromCursor: 0, toCursor: 2, recordCount: 2,
      signerKeyId: 'central', producedAt: new Date().toISOString(),
    };
    const records: BundleRecords = {
      kind: 'pull',
      records: [
        { seq: 1, entityType: 'setting', entityId: 's1', op: 'upsert', contentHash: 'h', body: 'on' },
        {
          seq: 2, entityType: 'terminology_system', entityId: SYS, op: 'upsert', contentHash: 'hg',
          body: {
            version: '2.77', kind: 'CodeSystem', resourceId: 'cs', generation: 5,
            concepts: [
              { code: 'A', display: 'Alpha', status: 'active', properties: { a: 1 } },
              { code: 'B', display: 'Bravo', status: 'active', properties: null },
            ],
          },
        },
      ],
    };
    const bytes = signBundle(manifest, records, kp.priv);

    const res = await importPullBundle(ctx, bytes);
    expect(res).toEqual({ applied: 2, toCursor: 2 }); // setting (mocked applier) + terminology (real reconcile)
    // The setting went through the reference applier (mocked); terminology did NOT.
    expect(H.appliedRef.map((r) => r.entityType)).toEqual(['setting']);
    expect(H.cursors['sync-pull']).toBe(2);

    // The concepts landed in the lab's terminology tables via the S3 reconcile, system stamped central.
    const conceptRows = await labDb.selectFrom('terminology_concepts').selectAll().where('system', '=', SYS).orderBy('code').execute();
    expect(conceptRows.map((r) => r.code)).toEqual(['A', 'B']);
    const sysRow = await labDb.selectFrom('terminology_systems').selectAll().where('url', '=', SYS).executeTakeFirst();
    expect(sysRow?.managed_origin).toBe('central');
    expect(Number(sysRow?.generation)).toBe(5);
  });

  it('applies an embedded concept_map: elements land in the lab via the reconcile, state stamped central', async () => {
    const labDb = await makeMigratedDb();
    const kp = hexKeys();
    const ctx = makeCtx({
      appSettings: fakeAppSettings({ 'sync.central_public_key': kp.pub }),
      internalDb: labDb,
    });

    const manifest: BundleManifest = {
      formatVersion: 1, kind: 'pull', siteId: SITE, fromCursor: 0, toCursor: 3, recordCount: 1,
      signerKeyId: 'central', producedAt: new Date().toISOString(),
    };
    const records: BundleRecords = {
      kind: 'pull',
      records: [
        {
          seq: 3, entityType: 'concept_map', entityId: MAP, op: 'upsert', contentHash: 'hm',
          body: {
            generation: 2,
            elements: [
              { sourceSystem: 'http://a', sourceCode: 'a1', targetSystem: 'http://b', targetCode: 'b1', equivalence: 'equivalent' },
              { sourceSystem: 'http://a', sourceCode: 'a2', targetSystem: 'http://b', targetCode: 'b2', equivalence: 'related-to' },
            ],
          },
        },
      ],
    };
    const bytes = signBundle(manifest, records, kp.priv);

    const res = await importPullBundle(ctx, bytes);
    expect(res).toEqual({ applied: 1, toCursor: 3 });

    const elemRows = await labDb.selectFrom('concept_map_elements').selectAll().where('map_url', '=', MAP).orderBy('source_code').execute();
    expect(elemRows.map((r) => r.source_code)).toEqual(['a1', 'a2']);
    const stateRow = await labDb.selectFrom('concept_map_state').selectAll().where('map_url', '=', MAP).executeTakeFirst();
    expect(stateRow?.managed_origin).toBe('central');
    expect(Number(stateRow?.generation)).toBe(2);
  });

  it('rejects a pull bundle that starts ahead of the consumed cursor (BundleGapError)', async () => {
    // reported cursor 10 → export window starts at fromCursor 10; lab has consumed only up to 0.
    const ctx = seedPullCtx(10);
    await exportPullBundle(ctx, { siteId: SITE });
    const bytes = lastBytes();
    const centralPub = (await ctx.appSettings.get('sync.central_signing_public_key'))!.value;
    (ctx.appSettings as ReturnType<typeof fakeAppSettings>)._map.set('sync.central_public_key', centralPub);

    H.cursors['sync-pull'] = 0; // consumed cursor behind the bundle's fromCursor (10)
    await expect(importPullBundle(ctx, bytes)).rejects.toBeInstanceOf(BundleGapError);
    expect(H.appliedRef).toHaveLength(0); // nothing applied
  });

  it('rejects a pull bundle signed by a non-central key (BundleSignatureError)', async () => {
    const ctx = seedPullCtx(0);
    await exportPullBundle(ctx, { siteId: SITE });
    const bytes = lastBytes();
    // Pin a WRONG central key on the lab.
    (ctx.appSettings as ReturnType<typeof fakeAppSettings>)._map.set('sync.central_public_key', hexKeys().pub);
    await expect(importPullBundle(ctx, bytes)).rejects.toBeInstanceOf(BundleSignatureError);
  });
});
