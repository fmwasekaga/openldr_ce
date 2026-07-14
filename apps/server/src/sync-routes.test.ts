import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
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

// Fake internal DB: a minimal chainable stand-in for the Kysely calls the pull handler makes —
// selectFrom(table).selectAll().where(col,op,val)...limit(n).execute() and .executeTakeFirst().
// Rows are supplied per table; where('seq','>',x) and where('id','=',x) are honoured.
function fakeInternalDb(tables: Record<string, any[]>) {
  return {
    selectFrom(table: string) {
      let rows = [...(tables[table] ?? [])];
      const b: any = {
        selectAll: () => b,
        where(col: string, op: string, val: any) {
          rows = rows.filter((r) => {
            const v = r[col];
            if (op === '>') return Number(v) > val;
            if (op === '=') return v === val;
            return true;
          });
          return b;
        },
        // Model the REAL query order: orderBy sorts, THEN limit slices — so "orderBy seq asc then
        // limit BATCH" yields the lowest-seq window (a slice-before-sort fake would mask that).
        orderBy() { rows = [...rows].sort((a, c) => Number(a.seq ?? 0) - Number(c.seq ?? 0)); return b; },
        limit(n: number) { rows = rows.slice(0, n); return b; },
        async execute() { return rows; },
        async executeTakeFirst() { return rows[0]; },
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
});
