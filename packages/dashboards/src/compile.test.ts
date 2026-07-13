import { describe, it, expect } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import { compileBuilderQuery, collectUsedJoins } from './compile';
import { getModel } from './models/registry';

// A dummy Kysely instance just for .compile() — no real DB.
const db = new Kysely<any>({ dialect: new SqliteDialect({ database: {} as any }) });

describe('compileBuilderQuery', () => {
  it('builds count grouped by a string dimension', () => {
    const model = getModel('service_requests')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests',
      metric: { key: 'count', agg: 'count' },
      dimension: { key: 'status' }, filters: [],
    }).compile();
    expect(sql).toContain('from "lab_requests"');
    expect(sql).toContain('count(*)');
    expect(sql).toContain('group by');
  });

  it('rejects an unknown dimension', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests',
      metric: { key: 'count', agg: 'count' },
      dimension: { key: 'evil_column' }, filters: [],
    })).toThrow(/unknown dimension/i);
  });

  it('rejects a metric column not in the model', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests',
      metric: { key: 'x', agg: 'avg', column: 'ssn' }, filters: [],
    })).toThrow(/unknown metric column/i);
  });

  it('applies an eq filter as a parameter', () => {
    const model = getModel('service_requests')!;
    const { parameters } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests',
      metric: { key: 'count', agg: 'count' }, filters: [{ dimension: 'status', op: 'eq', value: 'active' }],
    }).compile();
    expect(parameters).toContain('active');
  });

  it('groups by both the dimension and the breakdown', () => {
    const model = getModel('service_requests')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests',
      metric: { key: 'count', agg: 'count' },
      dimension: { key: 'status' }, breakdown: { key: 'code_text' }, filters: [],
    }).compile();
    expect(sql).toContain('"status"');
    expect(sql).toContain('"panel_desc"');
    expect((sql.match(/group by/gi) ?? []).length).toBe(1);
    expect(sql).toContain('"series"');
  });
});

describe('conditional metrics (Slice A)', () => {
  it('compiles a conditional count to a portable sum(case when …)', () => {
    const model = getModel('observations')!;
    const { sql, parameters } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'r', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
      dimension: { key: 'code_text' }, filters: [],
    }).compile();
    expect(sql).toContain('sum(case when');
    expect(sql).toContain('then 1 else 0 end)');
    expect(parameters).toContain('R'); // predicate value is bound, not inlined
  });

  it('wraps sum/avg/count_distinct conditionally', () => {
    const model = getModel('observations')!;
    const mk = (agg: string) => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'x', agg: agg as any, column: 'numeric_value', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'final' }] },
      filters: [],
    }).compile().sql;
    expect(mk('sum')).toContain('sum(case when');
    expect(mk('sum')).toContain('else 0 end)');
    expect(mk('avg')).toContain('avg(case when');
    expect(mk('count_distinct')).toContain('count(distinct case when');
  });

  it('leaves a plain count unchanged (no where)', () => {
    const model = getModel('observations')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [],
    }).compile();
    expect(sql).toContain('count(*)');
    expect(sql).not.toContain('case when');
  });

  it('rejects a conditional predicate on an unknown dimension', () => {
    const model = getModel('observations')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'r', agg: 'count', where: [{ dimension: 'evil', op: 'eq', value: 'R' }] },
      filters: [],
    })).toThrow(/unknown dimension/i);
  });

  it('supports in / gte / between predicate operators', () => {
    const model = getModel('observations')!;
    const s = (where: any) => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations', metric: { key: 'x', agg: 'count', where }, filters: [],
    }).compile().sql;
    expect(s([{ dimension: 'interpretation_code', op: 'in', value: ['R', 'I'] }])).toContain('in (');
    expect(s([{ dimension: 'effective_date_time', op: 'gte', value: '2024-01-01' }])).toContain('>=');
    expect(s([{ dimension: 'effective_date_time', op: 'between', value: ['2024-01-01', '2024-12-31'] }])).toContain('>=');
  });
});

describe('wide-mode compile (Slice A)', () => {
  it('selects one aliased column per metric, grouped by the dimension', () => {
    const model = getModel('observations')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'tested', agg: 'count' },
      metrics: [
        { key: 'tested', agg: 'count' },
        { key: 'r', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
      ],
      dimension: { key: 'code_text' }, filters: [],
    }).compile();
    expect(sql).toContain('as "tested"');
    expect(sql).toContain('as "r"');
    expect(sql).toContain('group by');
  });

  it('rejects wide mode combined with a breakdown', () => {
    const model = getModel('observations')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'count', agg: 'count' },
      metrics: [{ key: 'a', agg: 'count' }],
      dimension: { key: 'code_text' }, breakdown: { key: 'status' }, filters: [],
    })).toThrow(/breakdown/i);
  });

  it('rejects duplicate metric keys', () => {
    const model = getModel('observations')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'a', agg: 'count' },
      metrics: [{ key: 'a', agg: 'count' }, { key: 'a', agg: 'count' }],
      filters: [],
    })).toThrow(/duplicate metric key/i);
  });
});

describe('derived metrics compile (Slice B)', () => {
  it('does not emit a SQL column for a derived metric', () => {
    const model = getModel('observations')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'tested', agg: 'count' },
      metrics: [
        { key: 'tested', agg: 'count' },
        { key: 'pct', agg: 'count', derived: { numerator: 'tested', denominator: 'tested', scale: 100, decimals: 1 } },
      ],
      dimension: { key: 'code_text' }, filters: [],
    }).compile();
    expect(sql).toContain('as "tested"');
    expect(sql).not.toContain('as "pct"');
  });

  it('throws when a derived metric references an unknown metric', () => {
    const model = getModel('observations')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'tested', agg: 'count' },
      metrics: [
        { key: 'tested', agg: 'count' },
        { key: 'pct', agg: 'count', derived: { numerator: 'nope', denominator: 'tested', scale: 100, decimals: 1 } },
      ],
      filters: [],
    })).toThrow(/references unknown metric/i);
  });

  it('throws when a derived metric references another derived metric', () => {
    const model = getModel('observations')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'tested', agg: 'count' },
      metrics: [
        { key: 'tested', agg: 'count' },
        { key: 'a', agg: 'count', derived: { numerator: 'tested', denominator: 'tested', scale: 100, decimals: 1 } },
        { key: 'b', agg: 'count', derived: { numerator: 'a', denominator: 'tested', scale: 100, decimals: 1 } },
      ],
      filters: [],
    })).toThrow(/references unknown metric/i);
  });
});

describe('compileBuilderQuery filterTree (nested AND/OR)', () => {
  const model = getModel('service_requests')!; // adjust to the file's existing model-fetch helper

  it('compiles a nested AND/OR tree into and/or SQL', () => {
    const q = {
      mode: 'builder' as const, model: 'service_requests',
      metric: { key: 'count', agg: 'count' as const }, filters: [],
      filterTree: { kind: 'group', combinator: 'and', children: [
        { kind: 'rule', dimension: 'status', op: 'eq', value: 'completed' },
        { kind: 'group', combinator: 'or', children: [
          { kind: 'rule', dimension: 'code_text', op: 'eq', value: 'Blood culture' },
          { kind: 'rule', dimension: 'code_text', op: 'eq', value: 'Urine culture' },
        ] },
      ] },
    };
    const { sql } = compileBuilderQuery(db, model, q as any).compile();
    expect(sql).toMatch(/where/i);
    expect(sql).toMatch(/\bor\b/i);   // the OR subgroup
    expect(sql).toMatch(/\band\b/i);  // the AND root
  });

  it('ignores flat filters when a filterTree is present (precedence)', () => {
    const q = {
      mode: 'builder' as const, model: 'service_requests',
      metric: { key: 'count', agg: 'count' as const },
      filters: [{ dimension: 'priority', op: 'eq', value: 'urgent' }],
      filterTree: { kind: 'group', combinator: 'and', children: [ { kind: 'rule', dimension: 'status', op: 'eq', value: 'completed' } ] },
    };
    const { sql } = compileBuilderQuery(db, model, q as any).compile();
    expect(sql).not.toMatch(/priority/i); // flat filter superseded
  });

  it('emits SQL identical to today when no filterTree (backward-compat)', () => {
    const q = { mode: 'builder' as const, model: 'service_requests', metric: { key: 'count', agg: 'count' as const }, filters: [{ dimension: 'status', op: 'eq', value: 'completed' }] };
    const { sql } = compileBuilderQuery(db, model, q as any).compile();
    expect(sql).toMatch(/where/i);
    expect(sql).toMatch(/status/i);
    expect(sql).not.toMatch(/\bor\b/i);
  });

  it('adds no predicate (and does not throw) when every rule compiles away', () => {
    const q = {
      mode: 'builder' as const, model: 'service_requests',
      metric: { key: 'count', agg: 'count' as const }, filters: [],
      filterTree: { kind: 'group', combinator: 'and', children: [ { kind: 'rule', dimension: 'status', op: 'eq', value: null } ] },
    };
    const { sql } = compileBuilderQuery(db, model, q as any).compile();
    expect(sql).not.toMatch(/where/i); // null-valued rule → no where clause, no crash
  });
});

describe('compileBuilderQuery age_band computed dimension', () => {
  const model = getModel('patients')!;
  it('emits a CASE bucket with group by + order by for age_band', () => {
    const { sql } = compileBuilderQuery(db, model, { mode: 'builder', model: 'patients', metric: { key: 'count', agg: 'count' }, dimension: { key: 'age_band', reference: '2026-01-01' }, filters: [] } as any).compile();
    expect(sql).toMatch(/case when/i);
    expect(sql).toMatch(/group by/i);
    expect(sql).toMatch(/order by/i);
    // GROUP BY must contain BOTH the label + rank CASE expressions so ORDER BY rank is a grouped
    // expression on strict engines (pg/mssql). Old single-groupBy code has only 2 CASEs total → fails.
    expect(sql).toMatch(/group by case when [\s\S]* end, case when [\s\S]* end/i);
    expect((sql.match(/case when/gi) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it('a plain-column dimension emits byte-identical SQL (compute absent)', () => {
    const { sql } = compileBuilderQuery(db, model, { mode: 'builder', model: 'patients', metric: { key: 'count', agg: 'count' }, dimension: { key: 'gender' }, filters: [] } as any).compile();
    expect(sql).not.toMatch(/case when/i);
    expect(sql).toMatch(/group by "sex"/i);
    expect(sql).toMatch(/order by "sex"/i);
  });
});

describe('compileBuilderQuery age_band as breakdown', () => {
  const model = getModel('patients')!;
  it('emits a CASE bucket for a computed breakdown dimension (series)', () => {
    const { sql } = compileBuilderQuery(db, model, { mode: 'builder', model: 'patients', metric: { key: 'count', agg: 'count' }, breakdown: { key: 'age_band' }, filters: [] } as any).compile();
    expect(sql).toMatch(/case when/i);      // series is a CASE, not raw date_of_birth
    expect(sql).not.toMatch(/group by "date_of_birth"/i); // not grouped by the raw column
    expect(sql).not.toMatch(/"date_of_birth" as "series"/i); // series is not the raw column
  });
  it('a plain breakdown dimension emits raw column (byte-identical)', () => {
    const { sql } = compileBuilderQuery(db, model, { mode: 'builder', model: 'patients', metric: { key: 'count', agg: 'count' }, breakdown: { key: 'gender' }, filters: [] } as any).compile();
    expect(sql).toMatch(/group by "sex"/i);
    expect(sql).not.toMatch(/case when/i);
  });
});

describe('collectUsedJoins', () => {
  const model = getModel('observations')!;
  const base = { mode: 'builder' as const, model: 'observations', metric: { key: 'count', agg: 'count' as const }, filters: [] };
  it('collects the join for a facility dimension / breakdown / filter / filterTree / metric-where', () => {
    expect(collectUsedJoins(model, { ...base, dimension: { key: 'facility' } } as any).map((j) => j.alias)).toEqual(['jp']);
    expect(collectUsedJoins(model, { ...base, breakdown: { key: 'facility' } } as any).map((j) => j.alias)).toEqual(['jp']);
    expect(collectUsedJoins(model, { ...base, filters: [{ dimension: 'facility', op: 'eq', value: 'x' }] } as any).map((j) => j.alias)).toEqual(['jp']);
    expect(collectUsedJoins(model, { ...base, filterTree: { kind: 'group', combinator: 'and', children: [{ kind: 'rule', dimension: 'facility', op: 'eq', value: 'x' }] } } as any).map((j) => j.alias)).toEqual(['jp']);
    expect(collectUsedJoins(model, { ...base, metrics: [{ key: 'r', agg: 'count', where: [{ dimension: 'facility', op: 'eq', value: 'R' }] }] } as any).map((j) => j.alias)).toEqual(['jp']);
  });
  it('collects nothing when only base dimensions are used', () => {
    expect(collectUsedJoins(model, { ...base, dimension: { key: 'code_text' } } as any)).toEqual([]);
  });
});

describe('compileBuilderQuery cross-model join (facility)', () => {
  const model = getModel('observations')!;
  const base = { mode: 'builder' as const, model: 'observations', metric: { key: 'count', agg: 'count' as const } };
  it('adds a LEFT JOIN with a bare-id ON + qualified group-by when grouping by a joined dimension', () => {
    const { sql } = compileBuilderQuery(db, model, { ...base, dimension: { key: 'facility' }, filters: [] } as any).compile();
    expect(sql).toMatch(/left join "patients" as "jp"/i);
    expect(sql).not.toMatch(/replace\(/i);
    expect(sql).toMatch(/"lab_results"\."patient_id" = "jp"\."id"/i);
    expect(sql).toMatch(/group by "jp"\."managing_organization"/i);
  });
  it('adds the join when facility is only a filter, and qualifies the base group-by', () => {
    const { sql } = compileBuilderQuery(db, model, { ...base, dimension: { key: 'code_text' }, filters: [{ dimension: 'facility', op: 'eq', value: 'Org/1' }] } as any).compile();
    expect(sql).toMatch(/left join "patients" as "jp"/i);
    expect(sql).toMatch(/group by "lab_results"\."observation_desc"/i);
  });
  it('a join-free query emits byte-identical unqualified SQL (backward-compat)', () => {
    const { sql } = compileBuilderQuery(db, model, { ...base, dimension: { key: 'code_text' }, filters: [] } as any).compile();
    expect(sql).not.toMatch(/left join/i);
    expect(sql).toMatch(/group by "observation_desc"/i);
    expect(sql).not.toMatch(/"lab_results"\."observation_desc"/i);
  });
});
