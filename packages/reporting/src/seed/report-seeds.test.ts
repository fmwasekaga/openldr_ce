import { describe, it, expect } from 'vitest';
import {
  seedDataDrivenReports,
  SEED_QUERIES,
  SEED_DESIGNS,
  SEED_REPORT_DEFS,
  DEFAULT_CONNECTOR_NAME,
  ANTIBIOGRAM_PANEL,
  type SeedDataDrivenReportsDeps,
} from './report-seeds';

// In-memory fakes — no real Kysely instance needed (unlike `packages/bootstrap/src/seed.ts`,
// which builds `customQueries` from a real DB handle; here we inject fakes directly to unit-test
// `seedDataDrivenReports`'s own logic, in particular the Task-4.2 connector-resolution refinement
// and (Task 2, mssql-slice2b) the dialect-variant-selection refinement).
function fakeDeps(connectorList: { id: string; name: string; type?: string | null }[]) {
  const queries = new Map<string, { id: string; connectorId: string; sql: string }>();
  const designs = new Map<string, { id: string }>();
  const reportDefs = new Map<string, { id: string }>();
  const deps: SeedDataDrivenReportsDeps = {
    customQueries: {
      get: async (id) => (queries.has(id) ? (queries.get(id) as never) : null),
      create: async (q) => {
        queries.set(q.id, { id: q.id, connectorId: q.connectorId, sql: q.sql });
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

  // Task 2 (mssql-slice2b): seedDataDrivenReports must pick the SQL variant matching the
  // resolved warehouse connector's dialect (reversing Slice 1's "reports skip on MSSQL").
  it('resolves a postgres-typed warehouse connector and seeds the postgres SQL variant', async () => {
    const { deps, queries } = fakeDeps([{ id: 'conn-pg', name: DEFAULT_CONNECTOR_NAME, type: 'postgres' }]);
    await seedDataDrivenReports(deps);
    const testVolume = queries.get('q-test-volume');
    expect(testVolume?.sql).toContain('to_char(');
    expect(testVolume?.sql).not.toContain('format(');
  });

  it('resolves a microsoft-sql-typed warehouse connector by its own name and seeds the mssql SQL variant', async () => {
    const { deps, queries } = fakeDeps([{ id: 'conn-mssql', name: 'Target Warehouse (SQL Server)', type: 'microsoft-sql' }]);
    const res = await seedDataDrivenReports(deps);
    expect(res.queriesSeeded).toBe(SEED_QUERIES.length);
    const testVolume = queries.get('q-test-volume');
    expect(testVolume?.sql).toContain('format(');
    expect(testVolume?.sql).not.toContain('to_char(');
    for (const q of queries.values()) expect(q.connectorId).toBe('conn-mssql');
  });

  it('resolves a mysql-typed warehouse connector by its own name and seeds the mysql SQL variant', async () => {
    const { deps, queries } = fakeDeps([{ id: 'conn-mysql', name: 'Target Warehouse (MySQL/MariaDB)', type: 'mysql' }]);
    const res = await seedDataDrivenReports(deps);
    expect(res.queriesSeeded).toBe(SEED_QUERIES.length);
    const testVolume = queries.get('q-test-volume');
    // MySQL variant uses substr(...) month bucketing, not to_char/format.
    expect(testVolume?.sql).toContain('substr(');
    expect(testVolume?.sql).not.toContain('to_char(');
    expect(testVolume?.sql).not.toContain('format(');
    for (const q of queries.values()) expect(q.connectorId).toBe('conn-mysql');
  });
});

describe('SEED_QUERIES — every entry carries all three dialect variants', () => {
  it('has non-empty sql.postgres, sql.mssql, and sql.mysql for every seed query', () => {
    for (const q of SEED_QUERIES) {
      expect(q.sql.postgres.trim().length).toBeGreaterThan(0);
      expect(q.sql.mssql.trim().length).toBeGreaterThan(0);
      expect(q.sql.mysql.trim().length).toBeGreaterThan(0);
    }
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
    // throws "unbound parameter" at run time. Checked for ALL THREE dialect variants.
    for (const variant of [q?.sql.postgres, q?.sql.mssql, q?.sql.mysql]) {
      const tokens = [...(variant?.matchAll(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g) ?? [])].map((m) => m[1]);
      expect(new Set(tokens)).toEqual(new Set(['from', 'to', 'facility']));
    }
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

describe('ANTIBIOGRAM_PANEL', () => {
  it('includes every antibiotic actually present in the dev analytics DB (Task 6.1)', () => {
    // select distinct code_text from observations where interpretation_code in ('S','I','R')
    // order by 1 -- confirmed live against the dev DB (docker compose postgres, openldr_target).
    for (const a of ['Ampicillin', 'Ceftriaxone', 'Ciprofloxacin', 'Gentamicin']) {
      expect(ANTIBIOGRAM_PANEL).toContain(a);
    }
  });
});

describe('SEED_QUERIES — q-amr-antibiogram', () => {
  it('declares from/to as required plain params and generates one CASE column per panel antibiotic', () => {
    const q = SEED_QUERIES.find((x) => x.id === 'q-amr-antibiogram');
    expect(q).toBeTruthy();
    expect(q?.params).toEqual([
      { id: 'from', label: 'From', type: 'text', required: true },
      { id: 'to', label: 'To', type: 'text', required: true },
    ]);
    for (const variant of [q?.sql.postgres, q?.sql.mssql]) {
      const tokens = [...(variant?.matchAll(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g) ?? [])].map((m) => m[1]);
      expect(new Set(tokens)).toEqual(new Set(['from', 'to']));
      for (const a of ANTIBIOGRAM_PANEL) expect(variant).toContain(`"${a}"`);
      expect(variant).toContain('group by pathogen_code');
    }
    // The mysql variant uses BACKTICK aliases (double quotes are string literals in MySQL),
    // so assert the backtick-quoted identifier instead of the double-quoted one.
    {
      const tokens = [...(q?.sql.mysql?.matchAll(/\{\{\s*param\.([a-zA-Z0-9_]+)\s*\}\}/g) ?? [])].map((m) => m[1]);
      expect(new Set(tokens)).toEqual(new Set(['from', 'to']));
      for (const a of ANTIBIOGRAM_PANEL) expect(q?.sql.mysql).toContain(`\`${a}\``);
      expect(q?.sql.mysql).toContain('group by pathogen_code');
    }
  });
});

describe('SEED_DESIGNS — rt-amr-antibiogram', () => {
  it('binds pathogen + every panel antibiotic as a Letter/landscape table', () => {
    const d = SEED_DESIGNS.find((x) => x.id === 'rt-amr-antibiogram');
    expect(d).toBeTruthy();
    expect(d?.paper).toBe('Letter');
    expect(d?.orientation).toBe('landscape');
    const table = d?.pages[0].elements.find((e) => e.kind === 'table');
    expect(table?.boundColumns?.map((c) => c.key)).toEqual(['pathogen', ...ANTIBIOGRAM_PANEL]);
  });
});

describe('SEED_REPORT_DEFS — r-amr-antibiogram', () => {
  it('links rt-amr-antibiogram + q-amr-antibiogram, no facility filter, matching the catalog’s pathogens count metric', () => {
    const def = SEED_REPORT_DEFS.find((r) => r.id === 'r-amr-antibiogram');
    expect(def).toMatchObject({
      category: 'amr',
      designId: 'rt-amr-antibiogram',
      primaryQueryId: 'q-amr-antibiogram',
      summaryMetrics: [{ id: 'pathogens', label: 'Pathogens', type: 'count' }],
      paramOptions: null,
      status: 'published',
    });
  });
});
