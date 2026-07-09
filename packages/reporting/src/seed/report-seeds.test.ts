import { describe, it, expect } from 'vitest';
import {
  seedDataDrivenReports,
  SEED_QUERIES,
  SEED_DESIGNS,
  SEED_REPORT_DEFS,
  DEFAULT_CONNECTOR_NAME,
  type SeedDataDrivenReportsDeps,
} from './report-seeds';

// In-memory fakes — no real Kysely instance needed (unlike `packages/bootstrap/src/seed.ts`,
// which builds `customQueries` from a real DB handle; here we inject fakes directly to unit-test
// `seedDataDrivenReports`'s own logic, in particular the Task-4.2 connector-resolution refinement).
function fakeDeps(connectorList: { id: string; name: string }[]) {
  const queries = new Map<string, { id: string; connectorId: string }>();
  const designs = new Map<string, { id: string }>();
  const reportDefs = new Map<string, { id: string }>();
  const deps: SeedDataDrivenReportsDeps = {
    customQueries: {
      get: async (id) => (queries.has(id) ? (queries.get(id) as never) : null),
      create: async (q) => {
        queries.set(q.id, { id: q.id, connectorId: q.connectorId });
      },
    },
    designs: {
      get: async (id) => designs.get(id) as never,
      create: async (d) => {
        designs.set(d.id, { id: d.id });
        return d;
      },
    },
    reportDefs: {
      get: async (id) => reportDefs.get(id) as never,
      create: async (r) => {
        reportDefs.set(r.id, { id: r.id });
        return r;
      },
    },
    connectors: { list: async () => connectorList as never },
  };
  return { deps, queries, designs, reportDefs };
}

describe('seedDataDrivenReports', () => {
  it('skips entirely (all zero) when the default connector has not been seeded', async () => {
    const { deps, queries, designs, reportDefs } = fakeDeps([]);
    const res = await seedDataDrivenReports(deps);
    expect(res).toEqual({ queriesSeeded: 0, designsSeeded: 0, reportDefsSeeded: 0 });
    expect(queries.size).toBe(0);
    expect(designs.size).toBe(0);
    expect(reportDefs.size).toBe(0);
  });

  it('only matches the connector by exact name — a differently-named connector is not enough', async () => {
    const { deps } = fakeDeps([{ id: 'c-other', name: 'Some Other Connector' }]);
    const res = await seedDataDrivenReports(deps);
    expect(res).toEqual({ queriesSeeded: 0, designsSeeded: 0, reportDefsSeeded: 0 });
  });

  it('resolves the default connector by name and stamps its id onto every seed query', async () => {
    const { deps, queries, designs, reportDefs } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME }]);
    const res = await seedDataDrivenReports(deps);
    expect(res).toEqual({
      queriesSeeded: SEED_QUERIES.length,
      designsSeeded: SEED_DESIGNS.length,
      reportDefsSeeded: SEED_REPORT_DEFS.length,
    });
    expect(queries.size).toBe(SEED_QUERIES.length);
    for (const q of queries.values()) expect(q.connectorId).toBe('conn-123');
    expect(designs.has('rt-amr-resistance')).toBe(true);
    expect(reportDefs.has('r-amr-resistance')).toBe(true);
  });

  it('is idempotent — re-running with the same connector seeds nothing new', async () => {
    const { deps } = fakeDeps([{ id: 'conn-123', name: DEFAULT_CONNECTOR_NAME }]);
    await seedDataDrivenReports(deps);
    const second = await seedDataDrivenReports(deps);
    expect(second).toEqual({ queriesSeeded: 0, designsSeeded: 0, reportDefsSeeded: 0 });
  });
});

describe('SEED_QUERIES — q-amr-resistance', () => {
  it('declares from/to/facility as plain params matching the flat {from,to,facility} rawParams shape', () => {
    const q = SEED_QUERIES.find((x) => x.id === 'q-amr-resistance');
    expect(q).toBeTruthy();
    expect(q?.params).toEqual([
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
      { id: 'facility', label: 'Facility', type: 'text', required: false },
    ]);
    // {{param.*}} tokens present in the SQL must all be declared params, or substituteParams
    // throws "unbound parameter" at run time.
    const tokens = [...(q?.sql.matchAll(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g) ?? [])].map((m) => m[1]);
    expect(new Set(tokens)).toEqual(new Set(['from', 'to', 'facility']));
  });
});

describe('SEED_REPORT_DEFS — r-amr-resistance', () => {
  it('links rt-amr-resistance + q-amr-resistance with the catalog report’s metrics/chart/options', () => {
    const def = SEED_REPORT_DEFS.find((r) => r.id === 'r-amr-resistance');
    expect(def).toMatchObject({
      category: 'amr',
      designId: 'rt-amr-resistance',
      primaryQueryId: 'q-amr-resistance',
      paramOptions: { facility: 'q-facilities' },
      status: 'published',
    });
  });
});
