import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createFhirStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { registerSyncRoutes } from './sync-routes';

const SITE = 'lab-A';

// A record as it arrives on the wire (SyncRecord & { seq }).
function rec(id: string, version: number, seq: number, siteId = SITE) {
  return { resourceType: 'Patient', id, version, seq, op: 'upsert' as const, siteId, resource: { resourceType: 'Patient', id } };
}

// Fake ctx: verifyToken resolves/rejects on demand; applyRemote is scripted per-id or default.
function fakeCtx(opts: {
  verify?: (token: string) => Promise<Record<string, unknown>>;
  apply?: (record: any) => Promise<'applied' | 'skipped'>;
}) {
  const calls: { apply: any[] } = { apply: [] };
  const ctx = {
    logger: { warn: () => {}, error: () => {} },
    auth: {
      verifyToken:
        opts.verify ?? (async () => ({ sub: 'client-1', site_id: SITE })),
    },
    fhirStore: {
      applyRemote: async (record: any) => {
        calls.apply.push(record);
        return opts.apply ? opts.apply(record) : 'applied';
      },
    },
  } as any;
  return { ctx, calls };
}

function appWith(ctx: any) {
  const app = Fastify();
  registerSyncRoutes(app, ctx);
  return app;
}

const AUTH = { authorization: 'Bearer tok' };

describe('sync routes — POST /api/sync/push', () => {
  it('401 when no Authorization header', async () => {
    const { ctx } = fakeCtx({});
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', payload: { fromSeq: 0, records: [] } });
    expect(res.statusCode).toBe(401);
  });

  it('401 when verifyToken rejects', async () => {
    const { ctx, calls } = fakeCtx({ verify: async () => { throw new Error('bad'); } });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 0, records: [rec('p1', 1, 1)] } });
    expect(res.statusCode).toBe(401);
    expect(calls.apply.length).toBe(0);
  });

  it('403 when token has no site_id claim', async () => {
    const { ctx } = fakeCtx({ verify: async () => ({ sub: 'client-1' }) });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 0, records: [rec('p1', 1, 1)] } });
    expect(res.statusCode).toBe(403);
  });

  it('400 when records is not an array', async () => {
    const { ctx } = fakeCtx({});
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(400);
  });

  it('applies every same-site record, tallies applied, ackSeq = max seq', async () => {
    const { ctx, calls } = fakeCtx({});
    const records = [rec('p1', 1, 3), rec('p2', 1, 5), rec('p3', 1, 4)];
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 2, records } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ ackSeq: 5, applied: 3, skipped: 0, rejects: [] });
    expect(calls.apply.length).toBe(3);
    // applied in seq order
    expect(calls.apply.map((r: any) => r.seq)).toEqual([3, 4, 5]);
    expect(calls.apply[0].id).toBe('p1');
  });

  it('rejects a foreign-site record without applying it, still applies siblings', async () => {
    const { ctx, calls } = fakeCtx({});
    const records = [rec('p1', 1, 1), rec('evil', 2, 2, 'lab-B'), rec('p3', 1, 3)];
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 0, records } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(2);
    expect(body.skipped).toBe(0);
    expect(body.rejects).toEqual([{ id: 'evil', version: 2, seq: 2, reason: 'cross-site' }]);
    expect(body.ackSeq).toBe(3);
    expect(calls.apply.map((r: any) => r.id)).toEqual(['p1', 'p3']);
  });

  it('re-sent batch: applyRemote returns skipped for all → skipped tallied, applied 0', async () => {
    const { ctx } = fakeCtx({ apply: async () => 'skipped' });
    const records = [rec('p1', 1, 1), rec('p2', 1, 2)];
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 0, records } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(0);
    expect(body.skipped).toBe(2);
    expect(body.rejects).toEqual([]);
    expect(body.ackSeq).toBe(2);
  });

  it('a throwing applyRemote → apply-error reject, batch still 200, siblings applied', async () => {
    const { ctx } = fakeCtx({
      apply: async (r: any) => { if (r.id === 'boom') throw new Error('db down'); return 'applied'; },
    });
    const records = [rec('p1', 1, 1), rec('boom', 1, 2), rec('p3', 1, 3)];
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 0, records } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(2);
    expect(body.rejects).toEqual([{ id: 'boom', version: 1, seq: 2, reason: 'apply-error' }]);
    expect(body.ackSeq).toBe(3);
  });

  it('empty batch → ackSeq = fromSeq (cursor does not move backward)', async () => {
    const { ctx, calls } = fakeCtx({});
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 42, records: [] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ackSeq: 42, applied: 0, skipped: 0, rejects: [] });
    expect(calls.apply.length).toBe(0);
  });

  it('a record with a non-numeric seq is malformed and does not poison ackSeq', async () => {
    const { ctx, calls } = fakeCtx({});
    // The middle record has a string seq — a naive Math.max reduce would turn ackSeq into NaN → null.
    const bad = { resourceType: 'Patient', id: 'bad', version: 1, seq: 'oops', op: 'upsert', siteId: SITE, resource: {} };
    const records = [rec('p1', 1, 3), bad, rec('p2', 1, 7)];
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 1, records } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // ackSeq stays a finite number = max of the well-formed siblings (7), not NaN/null.
    expect(body.ackSeq).toBe(7);
    expect(Number.isFinite(body.ackSeq)).toBe(true);
    expect(body.applied).toBe(2);
    expect(body.rejects).toEqual([{ id: 'bad', version: 1, seq: 0, reason: 'malformed' }]);
    // The malformed record was never applied; the good siblings were.
    expect(calls.apply.map((r: any) => r.id)).toEqual(['p1', 'p2']);
  });

  it('a null / non-object element degrades to a malformed reject, batch still 200, siblings applied', async () => {
    const { ctx, calls } = fakeCtx({});
    // A naive comparator or site check would deref null → TypeError → 500 for the whole batch.
    const records = [rec('p1', 1, 1), null, 'not-a-record', rec('p3', 1, 4)];
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 0, records } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(2);
    // Two malformed rejects (order not asserted — both have seq 0).
    expect(body.rejects).toHaveLength(2);
    expect(body.rejects.every((x: any) => x.reason === 'malformed')).toBe(true);
    expect(body.ackSeq).toBe(4);
    // applyRemote called only for the two valid records.
    expect(calls.apply.map((r: any) => r.id).sort()).toEqual(['p1', 'p3']);
  });

  it('a record missing siteId is malformed (not cross-site)', async () => {
    const { ctx, calls } = fakeCtx({});
    const noSite = { resourceType: 'Patient', id: 'nosite', version: 1, seq: 2, op: 'upsert', resource: {} };
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { fromSeq: 0, records: [noSite] } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rejects).toEqual([{ id: 'nosite', version: 1, seq: 2, reason: 'malformed' }]);
    expect(calls.apply.length).toBe(0);
    // A malformed-but-seq-bearing record still advances the cursor past its seq.
    expect(body.ackSeq).toBe(2);
  });

  it('omitted fromSeq on an empty batch acks 0 (sane default)', async () => {
    const { ctx } = fakeCtx({});
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/push', headers: AUTH, payload: { records: [] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ackSeq: 0, applied: 0, skipped: 0, rejects: [] });
  });
});

// --- POST /api/sync/pull ------------------------------------------------------------------------

// One reference_change_log row (as read back from the internal DB — seq may be a string on real PG).
function logRow(seq: number | string, entityType: string, entityId: string, op: 'upsert' | 'delete', contentHash: string | null = 'h') {
  return { seq, entity_type: entityType, entity_id: entityId, op, content_hash: op === 'delete' ? null : contentHash };
}

// A raw form_definitions row (snake_case) as formSyncBody consumes it.
function formDefRow(id: string, name = `form ${id}`) {
  return {
    id, name, status: 'published', active: true,
    schema: { fields: [{ key: 'a' }] },
    fhir_version: 'R4', fhir_profile_url: null, facility_id: 'fac-1',
  };
}

// Raw internal rows (snake_case) for the three terminology metadata tables, as the serve branches
// read them via ctx.internalDb. match_prefixes is jsonb (an array once parsed by the pg driver).
function publisherRow(id: string, name = `pub ${id}`) {
  return { id, name, role: 'external', icon: null, match_prefixes: ['http://ex/'], seeded: false, sort_order: 3, managed_origin: null };
}
function codingSystemRow(id: string) {
  return { id, system_code: 'LOINC', system_name: 'LOINC', url: 'http://loinc.org', system_version: '2.7', description: 'd', active: true, publisher_id: null, seeded: false, managed_origin: null };
}
function termMappingRow(id: string) {
  return { id, from_system: 'http://a', from_code: 'a1', to_system: 'http://b', to_code: 'b1', to_display: 'B one', map_type: 'equivalent', relationship: 'related-to', owner: 'central-team', is_active: true, managed_origin: null };
}

// Value comparison that mirrors the engines: numeric when both operands are numbers (seq — a bigint
// string on PG), lexicographic otherwise (code / source_system / source_code text keys). This is what
// lets the keyset paging (WHERE code > afterCode ORDER BY code) be genuinely exercised.
function cmpVals(a: any, b: any): number {
  const na = Number(a);
  const nb = Number(b);
  const aNum = a !== '' && a != null && Number.isFinite(na);
  const bNum = b !== '' && b != null && Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

// A fake Kysely expression builder for the row-value keyset predicate the map-elements route builds via
// `.where((eb) => eb.or([eb(col,'>',v), eb.and([eb(col,'=',v), eb(col,'>',v)])]))`. Each eb(...) / eb.or
// / eb.and yields a { test(row) } predicate; the where() below applies it.
function makeEb() {
  const eb: any = (col: string, op: string, val: any) => ({
    test: (r: any) => {
      const v = r[col];
      if (op === '>') return cmpVals(v, val) > 0;
      if (op === '<') return cmpVals(v, val) < 0;
      if (op === '=') return v === val;
      return true;
    },
  });
  eb.or = (preds: any[]) => ({ test: (r: any) => preds.some((p) => p.test(r)) });
  eb.and = (preds: any[]) => ({ test: (r: any) => preds.every((p) => p.test(r)) });
  return eb;
}

// Fake internal DB: a minimal chainable stand-in for the Kysely calls the routes make —
// selectFrom(table).selectAll().where(...)...orderBy(col,dir)...limit(n).execute() / .executeTakeFirst().
// where() honours both the (col,op,val) form (seq/id/system/map_url filters) AND the callback form
// (map-elements row-value keyset). orderBy() accumulates keys and sorts by ALL of them (source_system
// then source_code), and — critically — sorting happens on execute() so that "orderBy THEN limit"
// yields the lowest-key window (a slice-before-sort fake would make the keyset paging tests vacuous).
function fakeInternalDb(tables: Record<string, any[]>) {
  return {
    selectFrom(table: string) {
      let rows = [...(tables[table] ?? [])];
      const orderKeys: string[] = [];
      let lim = Infinity;
      const b: any = {
        selectAll: () => b,
        where(colOrFn: any, op?: string, val?: any) {
          if (typeof colOrFn === 'function') {
            const pred = colOrFn(makeEb());
            rows = rows.filter((r) => pred.test(r));
          } else {
            rows = rows.filter((r) => {
              const v = r[colOrFn];
              if (op === '>') return cmpVals(v, val) > 0;
              if (op === '=') return v === val;
              return true;
            });
          }
          return b;
        },
        orderBy(col: string) { orderKeys.push(col); return b; },
        limit(n: number) { lim = n; return b; },
        materialize() {
          let out = rows;
          if (orderKeys.length) {
            out = [...rows].sort((a, c) => {
              for (const k of orderKeys) {
                const d = cmpVals(a[k], c[k]);
                if (d !== 0) return d;
              }
              return 0;
            });
          }
          return out.slice(0, lim);
        },
        async execute() { return b.materialize(); },
        async executeTakeFirst() { return b.materialize()[0]; },
      };
      return b;
    },
  };
}

function fakePullCtx(opts: {
  verify?: (token: string) => Promise<Record<string, unknown>>;
  log?: any[];
  forms?: any[];
  publishers?: any[];
  codingSystems?: any[];
  termMappings?: any[];
  dashboards?: Record<string, unknown>;
  reports?: Record<string, unknown>;
  settings?: Record<string, { value: string }>;
  terminologySystems?: any[];
  conceptMapState?: any[];
}) {
  const ctx = {
    logger: { warn: () => {}, error: () => {} },
    auth: { verifyToken: opts.verify ?? (async () => ({ sub: 'client-1', site_id: SITE })) },
    internalDb: fakeInternalDb({
      reference_change_log: opts.log ?? [],
      form_definitions: opts.forms ?? [],
      publishers: opts.publishers ?? [],
      coding_systems: opts.codingSystems ?? [],
      term_mappings: opts.termMappings ?? [],
      terminology_systems: opts.terminologySystems ?? [],
      concept_map_state: opts.conceptMapState ?? [],
    }),
    dashboards: { store: { get: async (id: string) => (opts.dashboards ?? {})[id] } },
    reportDefs: { get: async (id: string) => (opts.reports ?? {})[id] },
    appSettings: { get: async (id: string) => (opts.settings ?? {})[id] ?? null },
  } as any;
  return ctx;
}

describe('sync routes — POST /api/sync/pull', () => {
  it('401 when no Authorization header', async () => {
    const ctx = fakePullCtx({});
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(401);
  });

  it('403 when token has no site_id claim', async () => {
    const ctx = fakePullCtx({ verify: async () => ({ sub: 'client-1' }) });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(403);
  });

  it('serves the live body from each store for every entity type; nextSeq = max seq', async () => {
    const ctx = fakePullCtx({
      log: [
        logRow(1, 'dashboard', 'dash-1', 'upsert', 'hd'),
        logRow(2, 'report', 'rep-1', 'upsert', 'hr'),
        logRow(3, 'form', 'form-1', 'upsert', 'hf'),
        logRow(4, 'setting', 'set-1', 'upsert', 'hs'),
      ],
      dashboards: { 'dash-1': { id: 'dash-1', name: 'D', ownerId: null, layout: [], widgets: [], filters: [], refreshIntervalSec: 0, isDefault: false } },
      reports: { 'rep-1': { id: 'rep-1', name: 'R', description: '', category: 'amr', designId: 'd', primaryQueryId: 'q', summaryMetrics: null, chart: null, paramOptions: null, status: 'published' } },
      forms: [formDefRow('form-1')],
      settings: { 'set-1': { value: 'on' } },
    });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nextSeq).toBe(4);
    expect(body.records.map((r: any) => [r.seq, r.entityType, r.op])).toEqual([
      [1, 'dashboard', 'upsert'],
      [2, 'report', 'upsert'],
      [3, 'form', 'upsert'],
      [4, 'setting', 'upsert'],
    ]);
    // dashboard/report bodies = the store record shape the applier consumes.
    expect(body.records[0].body).toMatchObject({ name: 'D', refreshIntervalSec: 0 });
    expect(body.records[1].body).toMatchObject({ name: 'R', primaryQueryId: 'q', status: 'published' });
    // form body = formSyncBody output (camelCased subset, name carried, schema parsed).
    expect(body.records[2].body).toEqual({
      id: 'form-1', name: 'form form-1', status: 'published', active: true,
      schema: { fields: [{ key: 'a' }] }, fhirVersion: 'R4', fhirProfileUrl: null, facilityId: 'fac-1',
    });
    // setting body = the raw string value the applier String()s.
    expect(body.records[3].body).toBe('on');
    expect(body.records[3].contentHash).toBe('hs');
  });

  it('serves publisher/coding_system/term_mapping bodies from the internal DB (camelCase, round-trip)', async () => {
    const ctx = fakePullCtx({
      log: [
        logRow(1, 'publisher', 'pub-1', 'upsert', 'hp'),
        logRow(2, 'coding_system', 'cs-1', 'upsert', 'hc'),
        logRow(3, 'term_mapping', 'tm-1', 'upsert', 'ht'),
      ],
      publishers: [publisherRow('pub-1')],
      codingSystems: [codingSystemRow('cs-1')],
      termMappings: [termMappingRow('tm-1')],
    });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nextSeq).toBe(3);
    expect(body.records.map((r: any) => [r.seq, r.entityType, r.op])).toEqual([
      [1, 'publisher', 'upsert'],
      [2, 'coding_system', 'upsert'],
      [3, 'term_mapping', 'upsert'],
    ]);
    // publisher: match_prefixes jsonb parsed to an array, sortOrder carried.
    expect(body.records[0].body).toEqual({ id: 'pub-1', name: 'pub pub-1', role: 'external', icon: null, matchPrefixes: ['http://ex/'], sortOrder: 3 });
    // coding_system: camelCased subset the applier consumes.
    expect(body.records[1].body).toEqual({ id: 'cs-1', systemCode: 'LOINC', systemName: 'LOINC', url: 'http://loinc.org', systemVersion: '2.7', description: 'd', active: true, publisherId: null });
    // term_mapping: owner carried (preserve central's value), isActive camelCased.
    expect(body.records[2].body).toEqual({ id: 'tm-1', fromSystem: 'http://a', fromCode: 'a1', toSystem: 'http://b', toCode: 'b1', toDisplay: 'B one', mapType: 'equivalent', relationship: 'related-to', owner: 'central-team', isActive: true });
  });

  it('a publisher upsert whose live row is gone is downgraded to a delete record', async () => {
    const ctx = fakePullCtx({
      log: [logRow(8, 'publisher', 'pub-gone', 'upsert', 'h')],
      publishers: [], // row deleted since it was logged
    });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records).toEqual([{ seq: 8, entityType: 'publisher', entityId: 'pub-gone', op: 'delete' }]);
    expect(body.nextSeq).toBe(8);
  });

  it('collapses a create-then-delete in the window to ONE delete record; nextSeq spans the raw window', async () => {
    const ctx = fakePullCtx({
      log: [
        logRow(5, 'form', 'form-x', 'upsert', 'h1'),
        logRow(6, 'form', 'form-x', 'delete'),
      ],
      // Even though a live row exists, the LATEST log op is delete → served as delete (no body fetch).
      forms: [formDefRow('form-x')],
    });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 4 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records).toEqual([{ seq: 6, entityType: 'form', entityId: 'form-x', op: 'delete' }]);
    expect(body.nextSeq).toBe(6);
  });

  it('an upsert whose entity get() now returns null is downgraded to a delete record', async () => {
    const ctx = fakePullCtx({
      log: [logRow(7, 'dashboard', 'gone', 'upsert', 'h')],
      dashboards: {}, // get() → undefined
    });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records).toEqual([{ seq: 7, entityType: 'dashboard', entityId: 'gone', op: 'delete' }]);
    expect(body.nextSeq).toBe(7);
  });

  it('empty window (fromSeq at head) → { records: [], nextSeq: fromSeq }', async () => {
    const ctx = fakePullCtx({ log: [logRow(1, 'setting', 's', 'upsert')] });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 10 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ records: [], nextSeq: 10 });
  });

  it('missing / non-numeric fromSeq is treated as 0', async () => {
    const ctx = fakePullCtx({
      log: [logRow(1, 'setting', 's', 'upsert', 'h')],
      settings: { s: { value: 'v' } },
    });
    // no fromSeq at all
    let res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().records.map((r: any) => r.seq)).toEqual([1]);
    expect(res.json().nextSeq).toBe(1);
    // non-numeric fromSeq
    res = await appWith(fakePullCtx({ log: [logRow(1, 'setting', 's', 'upsert', 'h')], settings: { s: { value: 'v' } } }))
      .inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 'oops' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().records.map((r: any) => r.seq)).toEqual([1]);
  });

  it('seq read back as a string (real PG bigint) is coerced to a number', async () => {
    const ctx = fakePullCtx({
      log: [logRow('3', 'setting', 's', 'upsert', 'h')],
      settings: { s: { value: 'v' } },
    });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records[0].seq).toBe(3);
    expect(body.nextSeq).toBe(3);
  });

  it('a demoted (published→draft) form serves as a delete, not a draft upsert', async () => {
    // T4 does not capture a demotion, so the log's latest row stays 'upsert' while the live row is a
    // draft. The status gate must return null → the handler downgrades it to a delete (labs only
    // consume published forms; a demoted form is removed from labs).
    const draft = { ...formDefRow('form-d'), status: 'draft' };
    const ctx = fakePullCtx({ log: [logRow(2, 'form', 'form-d', 'upsert', 'h')], forms: [draft] });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records).toEqual([{ seq: 2, entityType: 'form', entityId: 'form-d', op: 'delete' }]);
    expect(body.nextSeq).toBe(2);
  });

  it('a throwing fetch (poison pill) skips the entity, no 500, cursor still advances via nextSeq', async () => {
    // A store.get that throws (DB error / malformed body) must NOT 500 the whole pull and wedge the
    // lab retrying this window forever. The bad entity is quarantined (no record emitted); nextSeq is
    // from the RAW window so the cursor advances past it, and healthy siblings still ship.
    const ctx = fakePullCtx({
      log: [
        logRow(1, 'setting', 'ok-1', 'upsert', 'h'),
        logRow(2, 'dashboard', 'boom', 'upsert', 'h'),
        logRow(3, 'setting', 'ok-2', 'upsert', 'h'),
      ],
      settings: { 'ok-1': { value: 'a' }, 'ok-2': { value: 'b' } },
    });
    // Make the dashboard get throw.
    ctx.dashboards.store.get = async () => { throw new Error('db down'); };
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 'boom' is quarantined — only the two healthy settings ship.
    expect(body.records.map((r: any) => r.entityId)).toEqual(['ok-1', 'ok-2']);
    // Cursor still advances past the poison pill (raw-window max seq = 3).
    expect(body.nextSeq).toBe(3);
  });

  it('caps the window at BATCH=500 by lowest seq (orderBy then limit), then resumes from nextSeq', async () => {
    const N = 600;
    const log: any[] = [];
    const settings: Record<string, { value: string }> = {};
    // Insert in DESCENDING seq order so insertion order != seq order — only a real "orderBy seq asc
    // THEN limit" yields the lowest-500 window (a slice-before-sort fake would return the wrong slice).
    for (let seq = N; seq >= 1; seq--) {
      log.push(logRow(seq, 'setting', `s${seq}`, 'upsert', 'h'));
      settings[`s${seq}`] = { value: `v${seq}` };
    }

    // First pull: the lowest-seq 500 (seq 1..500), nextSeq = 500.
    let res = await appWith(fakePullCtx({ log, settings }))
      .inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(200);
    let body = res.json();
    expect(body.records).toHaveLength(500);
    expect(body.records[0].seq).toBe(1);
    expect(body.records[499].seq).toBe(500);
    expect(body.nextSeq).toBe(500);

    // Follow-up pull from nextSeq returns the remaining 100 (seq 501..600).
    res = await appWith(fakePullCtx({ log, settings }))
      .inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 500 } });
    expect(res.statusCode).toBe(200);
    body = res.json();
    expect(body.records).toHaveLength(100);
    expect(body.records[0].seq).toBe(501);
    expect(body.records[99].seq).toBe(600);
    expect(body.nextSeq).toBe(600);
  });

  it('serves a terminology_system signal as a DESCRIPTOR (url/version/kind/resourceId/generation), not concepts', async () => {
    const ctx = fakePullCtx({
      log: [logRow(9, 'terminology_system', 'http://loinc.org', 'upsert', 'hg')],
      terminologySystems: [
        { url: 'http://loinc.org', version: '2.77', kind: 'code-system', resource_id: 'cs-loinc', generation: '4', managed_origin: null },
      ],
    });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records).toHaveLength(1);
    const r = body.records[0];
    expect([r.seq, r.entityType, r.op]).toEqual([9, 'terminology_system', 'upsert']);
    // bigint generation coerced to a Number; no concepts array in the descriptor.
    expect(r.body).toEqual({ url: 'http://loinc.org', version: '2.77', kind: 'code-system', resourceId: 'cs-loinc', generation: 4 });
    expect(r.body.concepts).toBeUndefined();
    expect(body.nextSeq).toBe(9);
  });

  it('serves a concept_map signal as a DESCRIPTOR ({ mapUrl, generation })', async () => {
    const ctx = fakePullCtx({
      log: [logRow(3, 'concept_map', 'http://ex/map', 'upsert', 'hm')],
      conceptMapState: [{ map_url: 'http://ex/map', generation: '2', managed_origin: null }],
    });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records[0].body).toEqual({ mapUrl: 'http://ex/map', generation: 2 });
  });

  it('a terminology_system whose live row is gone is downgraded to a delete record', async () => {
    const ctx = fakePullCtx({
      log: [logRow(9, 'terminology_system', 'http://gone', 'upsert', 'h')],
      terminologySystems: [], // metadata row removed since it was logged
    });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().records).toEqual([{ seq: 9, entityType: 'terminology_system', entityId: 'http://gone', op: 'delete' }]);
  });
});

// --- POST /api/sync/terminology/concepts ---------------------------------------------------------

// A raw terminology_concepts row (snake_case) as the concepts route reads it. properties is jsonb.
function conceptRow(system: string, code: string, extras: Record<string, unknown> = {}) {
  return { system, code, display: `d-${code}`, status: 'active', properties: null, ...extras };
}

function fakeTermCtx(opts: {
  verify?: (token: string) => Promise<Record<string, unknown>>;
  concepts?: any[];
  mapElements?: any[];
}) {
  return {
    logger: { warn: () => {}, error: () => {} },
    auth: { verifyToken: opts.verify ?? (async () => ({ sub: 'client-1', site_id: SITE })) },
    internalDb: fakeInternalDb({
      terminology_concepts: opts.concepts ?? [],
      concept_map_elements: opts.mapElements ?? [],
    }),
  } as any;
}

describe('sync routes — POST /api/sync/terminology/concepts', () => {
  it('401 when no Authorization header', async () => {
    const ctx = fakeTermCtx({});
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/terminology/concepts', payload: { systemUrl: 'http://x' } });
    expect(res.statusCode).toBe(401);
  });

  it('403 when token has no site_id claim', async () => {
    const ctx = fakeTermCtx({ verify: async () => ({ sub: 'client-1' }) });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/terminology/concepts', headers: AUTH, payload: { systemUrl: 'http://x' } });
    expect(res.statusCode).toBe(403);
  });

  it('400 when systemUrl is missing', async () => {
    const ctx = fakeTermCtx({});
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/terminology/concepts', headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('unknown system → { concepts: [], nextCode: null }', async () => {
    const ctx = fakeTermCtx({ concepts: [conceptRow('http://other', 'c01')] });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/terminology/concepts', headers: AUTH, payload: { systemUrl: 'http://x' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ concepts: [], nextCode: null });
  });

  it('keyset-pages by code: first page (limit L<N) + nextCode, resume via afterCode, last page nextCode=null', async () => {
    const SYS = 'http://loinc.org';
    // Insert in DESCENDING code order so insertion order != sort order — only a real "orderBy code asc
    // THEN limit" yields the lowest-code page (a slice-before-sort fake would return the wrong slice).
    const concepts: any[] = [];
    for (let i = 5; i >= 1; i--) concepts.push(conceptRow(SYS, `c0${i}`, { display: `D${i}`, status: 'active', properties: { rank: i } }));
    // A decoy from another system must never appear.
    concepts.push(conceptRow('http://other', 'c01'));

    // First page: limit 2 → c01, c02; nextCode = 'c02'.
    let res = await appWith(fakeTermCtx({ concepts }))
      .inject({ method: 'POST', url: '/api/sync/terminology/concepts', headers: AUTH, payload: { systemUrl: SYS, limit: 2 } });
    expect(res.statusCode).toBe(200);
    let body = res.json();
    expect(body.concepts.map((c: any) => c.code)).toEqual(['c01', 'c02']);
    // properties jsonb surfaced as an object; display/status carried.
    expect(body.concepts[0]).toEqual({ code: 'c01', display: 'D1', status: 'active', properties: { rank: 1 } });
    expect(body.nextCode).toBe('c02');

    // Resume: afterCode 'c02', limit 2 → c03, c04; nextCode = 'c04'.
    res = await appWith(fakeTermCtx({ concepts }))
      .inject({ method: 'POST', url: '/api/sync/terminology/concepts', headers: AUTH, payload: { systemUrl: SYS, afterCode: 'c02', limit: 2 } });
    body = res.json();
    expect(body.concepts.map((c: any) => c.code)).toEqual(['c03', 'c04']);
    expect(body.nextCode).toBe('c04');

    // Last (short) page: afterCode 'c04', limit 2 → only c05; nextCode = null (done).
    res = await appWith(fakeTermCtx({ concepts }))
      .inject({ method: 'POST', url: '/api/sync/terminology/concepts', headers: AUTH, payload: { systemUrl: SYS, afterCode: 'c04', limit: 2 } });
    body = res.json();
    expect(body.concepts.map((c: any) => c.code)).toEqual(['c05']);
    expect(body.nextCode).toBeNull();
  });

  it('parses jsonb properties supplied as a string', async () => {
    const ctx = fakeTermCtx({ concepts: [conceptRow('http://x', 'c1', { properties: '{"a":1}' })] });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/terminology/concepts', headers: AUTH, payload: { systemUrl: 'http://x' } });
    expect(res.json().concepts[0].properties).toEqual({ a: 1 });
  });
});

// --- POST /api/sync/terminology/map-elements -----------------------------------------------------

// A raw concept_map_elements row (snake_case).
function mapElemRow(mapUrl: string, sourceSystem: string, sourceCode: string, extras: Record<string, unknown> = {}) {
  return {
    map_url: mapUrl,
    source_system: sourceSystem,
    source_code: sourceCode,
    target_system: 'http://t',
    target_code: `t-${sourceCode}`,
    equivalence: 'equivalent',
    ...extras,
  };
}

describe('sync routes — POST /api/sync/terminology/map-elements', () => {
  it('401 when no Authorization header', async () => {
    const ctx = fakeTermCtx({});
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/terminology/map-elements', payload: { mapUrl: 'http://m' } });
    expect(res.statusCode).toBe(401);
  });

  it('403 when token has no site_id claim', async () => {
    const ctx = fakeTermCtx({ verify: async () => ({ sub: 'client-1' }) });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/terminology/map-elements', headers: AUTH, payload: { mapUrl: 'http://m' } });
    expect(res.statusCode).toBe(403);
  });

  it('400 when mapUrl is missing', async () => {
    const ctx = fakeTermCtx({});
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/terminology/map-elements', headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('unknown map → { elements: [], nextKey: null }', async () => {
    const ctx = fakeTermCtx({ mapElements: [mapElemRow('http://other', 'sys-a', 's01')] });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/terminology/map-elements', headers: AUTH, payload: { mapUrl: 'http://m' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ elements: [], nextKey: null });
  });

  it('row-value keyset over (source_system, source_code): first page + nextKey, resume, last page null', async () => {
    const MAP = 'http://ex/map';
    // Two source systems; within each, several codes. Insert scrambled so only a genuine
    // orderBy(source_system).orderBy(source_code) THEN limit yields the intended lowest-key window.
    const els: any[] = [
      mapElemRow(MAP, 'sys-b', 's01'),
      mapElemRow(MAP, 'sys-a', 's02'),
      mapElemRow(MAP, 'sys-b', 's02'),
      mapElemRow(MAP, 'sys-a', 's01'),
      mapElemRow(MAP, 'sys-a', 's03'),
      // decoy from another map
      mapElemRow('http://other', 'sys-a', 's00'),
    ];
    // Sorted order over this map: (sys-a,s01),(sys-a,s02),(sys-a,s03),(sys-b,s01),(sys-b,s02).

    // First page limit 2 → (sys-a,s01),(sys-a,s02); nextKey = {sys-a, s02}.
    let res = await appWith(fakeTermCtx({ mapElements: els }))
      .inject({ method: 'POST', url: '/api/sync/terminology/map-elements', headers: AUTH, payload: { mapUrl: MAP, limit: 2 } });
    expect(res.statusCode).toBe(200);
    let body = res.json();
    expect(body.elements.map((e: any) => [e.sourceSystem, e.sourceCode])).toEqual([['sys-a', 's01'], ['sys-a', 's02']]);
    expect(body.elements[0]).toEqual({ sourceSystem: 'sys-a', sourceCode: 's01', targetSystem: 'http://t', targetCode: 't-s01', equivalence: 'equivalent' });
    expect(body.nextKey).toEqual({ sourceSystem: 'sys-a', sourceCode: 's02' });

    // Resume from nextKey → (sys-a,s03),(sys-b,s01); nextKey = {sys-b, s01}. This crosses the
    // source_system boundary — exercises the (ss > x) OR (ss = x AND sc > y) row-value predicate.
    res = await appWith(fakeTermCtx({ mapElements: els }))
      .inject({ method: 'POST', url: '/api/sync/terminology/map-elements', headers: AUTH, payload: { mapUrl: MAP, afterSourceSystem: 'sys-a', afterSourceCode: 's02', limit: 2 } });
    body = res.json();
    expect(body.elements.map((e: any) => [e.sourceSystem, e.sourceCode])).toEqual([['sys-a', 's03'], ['sys-b', 's01']]);
    expect(body.nextKey).toEqual({ sourceSystem: 'sys-b', sourceCode: 's01' });

    // Last (short) page → only (sys-b,s02); nextKey = null.
    res = await appWith(fakeTermCtx({ mapElements: els }))
      .inject({ method: 'POST', url: '/api/sync/terminology/map-elements', headers: AUTH, payload: { mapUrl: MAP, afterSourceSystem: 'sys-b', afterSourceCode: 's01', limit: 2 } });
    body = res.json();
    expect(body.elements.map((e: any) => [e.sourceSystem, e.sourceCode])).toEqual([['sys-b', 's02']]);
    expect(body.nextKey).toBeNull();
  });
});

// --- POST /api/sync/pull-amendments --------------------------------------------------------------

// serveAmendments is a REAL @openldr/bootstrap import (not stubbable), so this suite backs ctx with a
// migrated pg-mem internalDb + a real FhirStore, seeds amendments per site, and asserts the route
// passes the token's site through — proving the endpoint is genuinely site-scoped.
function fakeAmendCtx(db: any, opts: { verify?: (token: string) => Promise<Record<string, unknown>> } = {}) {
  return {
    logger: { warn: () => {}, error: () => {}, info: () => {} },
    auth: { verifyToken: opts.verify ?? (async () => ({ sub: 'client-1', site_id: 'lab-a' })) },
    internalDb: db,
  } as any;
}

// Seed one amended Observation for `siteId` (applyRemote to create, then amend to enqueue an outbox row).
async function seedAmendment(db: any, siteId: string, id: string) {
  const store = createFhirStore(db);
  await store.applyRemote({
    resourceType: 'Observation',
    id,
    version: 1,
    op: 'upsert',
    siteId,
    resource: { resourceType: 'Observation', id, status: 'preliminary' } as any,
  });
  await store.amend({ resourceType: 'Observation', id, status: 'amended', agent: 'c' });
}

describe('sync routes — POST /api/sync/pull-amendments', () => {
  it('401 when no Authorization header', async () => {
    const db = await makeMigratedDb();
    const res = await appWith(fakeAmendCtx(db)).inject({ method: 'POST', url: '/api/sync/pull-amendments', payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(401);
  });

  it('403 when token has no site_id claim', async () => {
    const db = await makeMigratedDb();
    const ctx = fakeAmendCtx(db, { verify: async () => ({ sub: 'client-1' }) });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull-amendments', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(403);
  });

  it('200 with the token-site amendments as SyncRecords scoped to that site', async () => {
    const db = await makeMigratedDb();
    await seedAmendment(db, 'lab-a', 'obs-a');
    await seedAmendment(db, 'lab-b', 'obs-b'); // a foreign-site amendment that must NOT leak
    // verifyToken resolves lab-a → the route must pass 'lab-a' through to serveAmendments.
    const ctx = fakeAmendCtx(db, { verify: async () => ({ sub: 'client-1', site_id: 'lab-a' }) });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull-amendments', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records.length).toBeGreaterThanOrEqual(1);
    expect(typeof body.nextSeq).toBe('number');
    // Every record belongs to lab-a — lab-b's amendment never appears.
    expect(body.records.every((r: any) => r.siteId === 'lab-a')).toBe(true);
    expect(body.records.some((r: any) => r.id === 'obs-b')).toBe(false);
  });

  it('a token for a DIFFERENT site sees 0 records (site-scoping proven)', async () => {
    const db = await makeMigratedDb();
    await seedAmendment(db, 'lab-a', 'obs-a'); // only lab-a has amendments
    // A lab-b token must drain ONLY lab-b's (empty) stream — not lab-a's.
    const ctx = fakeAmendCtx(db, { verify: async () => ({ sub: 'client-2', site_id: 'lab-b' }) });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull-amendments', headers: AUTH, payload: { fromSeq: 0 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records).toHaveLength(0);
    // Empty window → nextSeq stays at fromSeq (never moves backward).
    expect(body.nextSeq).toBe(0);
  });

  it('non-numeric fromSeq is sanitized to 0', async () => {
    const db = await makeMigratedDb();
    await seedAmendment(db, 'lab-a', 'obs-a');
    const ctx = fakeAmendCtx(db, { verify: async () => ({ sub: 'client-1', site_id: 'lab-a' }) });
    const res = await appWith(ctx).inject({ method: 'POST', url: '/api/sync/pull-amendments', headers: AUTH, payload: { fromSeq: 'oops' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().records.length).toBeGreaterThanOrEqual(1);
  });
});
