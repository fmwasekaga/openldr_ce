import { describe, it, expect } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import { compileBuilderQuery, collectUsedJoins, effectiveModel, runBuilderQuery } from './compile';
import { getModel, type ColumnPolicy } from './models/registry';

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

const SR = () => getModel('service_requests')!;
const q = (over: Record<string, unknown>) => ({
  mode: 'builder' as const, model: 'service_requests',
  metric: { key: 'count', agg: 'count' as const }, filters: [], ...over,
});

describe('effectiveModel', () => {
  it('merges a valid adhoc dimension into the model dimensions', () => {
    const em = effectiveModel(SR(), q({
      adhocDimensions: [{ key: 'jp__sex', label: 'Patient Sex', join: 'jp', column: 'sex', kind: 'string' }],
    }) as any);
    expect(em.dimensions.find((d) => d.key === 'jp__sex')).toMatchObject({ column: 'sex', join: 'jp', kind: 'string' });
  });

  it('is a no-op (same reference) when there are no adhoc dimensions', () => {
    const m = SR();
    expect(effectiveModel(m, q({}) as any)).toBe(m);
  });

  it('rejects an adhoc dimension on a non-optional / unknown join', () => {
    expect(() => effectiveModel(SR(), q({
      adhocDimensions: [{ key: 'x', label: 'X', join: 'nope', column: 'sex', kind: 'string' }],
    }) as any)).toThrow(/join/i);
  });

  it('rejects an adhoc dimension whose column is denied or not exposable', () => {
    expect(() => effectiveModel(SR(), q({
      adhocDimensions: [{ key: 'x', label: 'X', join: 'jp', column: 'surname', kind: 'string' }],
    }) as any)).toThrow(/column/i);
  });
});

describe('compileBuilderQuery with an adhoc join column', () => {
  it('adds the LEFT JOIN and groups by the joined column', () => {
    const built = q({
      adhocDimensions: [{ key: 'jp__sex', label: 'Patient Sex', join: 'jp', column: 'sex', kind: 'string' }],
      dimension: { key: 'jp__sex' },
    });
    const sql = compileBuilderQuery(db, getModel('service_requests')!, built as any).compile().sql;
    expect(sql).toMatch(/left join .*patients/i);
    expect(sql).toMatch(/jp"?\."?sex/i);
  });

  it('runBuilderQuery rejects a denied adhoc column (guard runs on the run path)', async () => {
    await expect(runBuilderQuery(db, getModel('service_requests')!, q({
      adhocDimensions: [{ key: 'x', label: 'X', join: 'jp', column: 'surname', kind: 'string' }],
    }) as any)).rejects.toThrow(/column/i);
  });

  it('runBuilderQuery rejects an adhoc column the runtime policy hides', async () => {
    // 'sex' is normally exposable on patients; a policy that hides it must reject the adhoc dim.
    const policy: ColumnPolicy = new Map([['patients', new Set(['sex'])]]);
    await expect(runBuilderQuery(db, getModel('service_requests')!, q({
      adhocDimensions: [{ key: 'x', label: 'X', column: 'sex', kind: 'string', join: 'jp' }],
    }) as any, policy)).rejects.toThrow(/not exposable/);
  });

  it('runBuilderQuery accepts a column the policy exposes that the union would hide', async () => {
    // 'source_system' is in the union fallback (hidden) but an explicit empty policy exposes it.
    // No measure, so runBuilderQuery validates via effectiveModel then returns its early "no measure"
    // result without reaching db.execute() (this suite's `db` is a compile-only stub, no real driver).
    const policy: ColumnPolicy = new Map([['patients', new Set()]]);
    const res = await runBuilderQuery(db, getModel('service_requests')!, q({
      adhocDimensions: [{ key: 'ss', label: 'SS', column: 'source_system', kind: 'string', join: 'jp' }],
      metric: undefined,
    }) as any, policy);
    expect(res).toBeTruthy(); // no throw = column accepted
  });

  it('adds the LEFT JOIN when the adhoc column is used as a breakdown', () => {
    const sql = compileBuilderQuery(db, getModel('service_requests')!, q({
      adhocDimensions: [{ key: 'jp__sex', label: 'Patient Sex', join: 'jp', column: 'sex', kind: 'string' }],
      dimension: { key: 'authored_on' },
      breakdown: { key: 'jp__sex' },
    }) as any).compile().sql;
    expect(sql).toMatch(/left join .*patients/i);
  });
});

describe('compileBuilderQuery multiple optional joins', () => {
  it('emits a leftJoin per distinct optional join referenced, with qualified refs', () => {
    const model = getModel('observations')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'count', agg: 'count' },
      adhocDimensions: [
        { key: 'js__status', label: 'Specimen Status', join: 'js', column: 'status', kind: 'string' },
        { key: 'jr__priority', label: 'Request Priority', join: 'jr', column: 'priority', kind: 'string' },
      ],
      dimension: { key: 'js__status' },
      filters: [{ dimension: 'jr__priority', op: 'eq', value: 'high' }],
    } as any).compile();
    expect(sql).toMatch(/left join "specimens" as "js"/i);
    expect(sql).toMatch(/left join "lab_requests" as "jr"/i);
    expect(sql).toMatch(/"js"\."status" as "label"/i);
    expect(sql).not.toMatch(/as "jp"/i); // the non-optional patients join is not referenced → not emitted
  });

  it('rejects an ad-hoc column that the denylist excludes', () => {
    const model = getModel('observations')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'count', agg: 'count' },
      adhocDimensions: [{ key: 'js__patient_id', label: 'x', join: 'js', column: 'patient_id', kind: 'string' }],
      dimension: { key: 'js__patient_id' }, filters: [],
    } as any)).toThrow(/not exposable/i);
  });
});

describe('builder query with no measure', () => {
  const noMeasure = { mode: 'builder' as const, model: 'service_requests', filters: [] };

  it('runBuilderQuery returns an empty result without executing SQL', async () => {
    const res = await runBuilderQuery(db, getModel('service_requests')!, noMeasure as any);
    expect(res.rows).toEqual([]);
    expect(res.columns).toEqual([]);
  });

  it('compileBuilderQuery does not throw for a no-measure query (SQL preview path)', () => {
    expect(() => compileBuilderQuery(db, getModel('service_requests')!, noMeasure as any).compile()).not.toThrow();
  });
});

describe('custom columns (row-level computed dimension)', () => {
  it('compiles a concat custom column as a group-by via CONCAT with bound literals', () => {
    const model = getModel('service_requests')!;
    const { sql, parameters } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'sp', label: 'Status/Priority', expr: { kind: 'concat', parts: [
        { type: 'field', dimension: 'status' }, { type: 'string', value: ' / ' }, { type: 'field', dimension: 'priority' },
      ] } }],
      dimension: { key: 'sp' },
    } as any).compile();
    expect(sql).toMatch(/concat\(/i);
    expect(sql).toMatch(/as "label"/i);
    expect(sql).toMatch(/group by/i);
    expect(parameters).toContain(' / ');       // literal is a bound parameter…
    expect(sql).not.toContain(' / ');          // …not inlined into the SQL text
  });

  it('compiles arithmetic with div-by-zero guarded by nullif', () => {
    const model = getModel('service_requests')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'ratio', label: 'Ratio', expr: { kind: 'arithmetic', op: '/',
        left: { type: 'number', value: 10 }, right: { type: 'number', value: 1000 } } }],
      dimension: { key: 'ratio' },
    } as any).compile();
    expect(sql).toMatch(/nullif\(/i);
  });

  it('rejects an arithmetic operand that is not a number field', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'x', label: 'x', expr: { kind: 'arithmetic', op: '-',
        left: { type: 'field', dimension: 'status' }, right: { type: 'number', value: 1 } } }],
      dimension: { key: 'x' },
    } as any)).toThrow(/must be a number field/i);
  });

  it('compiles arithmetic over a numeric dimension', () => {
    // Inline model with a numeric dimension (the registry currently has none).
    const model = { id: 'nums', label: 'Nums', table: 'lab_results',
      dimensions: [{ key: 'nv', label: 'Numeric Value', column: 'numeric_value', kind: 'number' }],
      metrics: [{ key: 'count', label: 'Count', agg: 'count' }] } as any;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'nums', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'scaled', label: 'Scaled', expr: { kind: 'arithmetic', op: '/',
        left: { type: 'field', dimension: 'nv' }, right: { type: 'number', value: 1000 } } }],
      dimension: { key: 'scaled' },
    } as any).compile();
    expect(sql).toMatch(/nullif\(/i);
    expect(sql).toMatch(/as "label"/i);
  });

  it('fires the join for a custom column whose operand references a joined dimension', () => {
    const model = getModel('observations')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'fc', label: 'Facility/Analyte', expr: { kind: 'concat', parts: [
        { type: 'field', dimension: 'facility' }, { type: 'string', value: '/' }, { type: 'field', dimension: 'code_text' },
      ] } }],
      dimension: { key: 'fc' },
    } as any).compile();
    expect(sql).toMatch(/left join "patients" as "jp"/i); // 'facility' → join jp, pulled in via the custom column
  });

  it('rejects a custom column referencing an unknown field', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'x', label: 'x', expr: { kind: 'concat', parts: [{ type: 'field', dimension: 'nope' }] } }],
      dimension: { key: 'x' },
    } as any)).toThrow(/unknown field/i);
  });

  it('rejects a custom column whose operand is itself computed (no nesting)', () => {
    const model = getModel('patients')!; // has age_band (computed)
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'patients', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'x', label: 'x', expr: { kind: 'concat', parts: [{ type: 'field', dimension: 'age_band' }] } }],
      dimension: { key: 'x' },
    } as any)).toThrow(/computed/i);
  });

  it('compiles a concat custom column as a breakdown (series)', () => {
    const model = getModel('service_requests')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'sp', label: 'Status/Priority', expr: { kind: 'concat', parts: [
        { type: 'field', dimension: 'status' }, { type: 'field', dimension: 'priority' },
      ] } }],
      dimension: { key: 'status' }, breakdown: { key: 'sp' },
    } as any).compile();
    expect(sql).toMatch(/concat\(/i);
    expect(sql).toMatch(/as "series"/i);
  });

  it('compiles an arithmetic custom column over a registry numeric dimension', () => {
    const model = getModel('observations')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'observations', metric: { key: 'count', agg: 'count' }, filters: [],
      customColumns: [{ key: 'scaled', label: 'Scaled', expr: { kind: 'arithmetic', op: '/',
        left: { type: 'field', dimension: 'value' }, right: { type: 'number', value: 1000 } } }],
      dimension: { key: 'scaled' },
    } as any).compile();
    expect(sql).toMatch(/nullif\(/i);
    expect(sql).toMatch(/as "label"/i);
  });

  it('refuses to use a custom column as a filter field', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' },
      customColumns: [{ key: 'sp', label: 'x', expr: { kind: 'concat', parts: [{ type: 'field', dimension: 'status' }] } }],
      filters: [{ dimension: 'sp', op: 'eq', value: 'X' }],
    } as any)).toThrow(/custom column/i);
  });
});

describe('user-defined (arbitrary) joins', () => {
  it('synthesizes a user join into a leftJoin with qualified refs', () => {
    const model = getModel('service_requests')!; // base table lab_requests
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      userJoins: [{ id: 'u1', table: 'patients', left: 'patient_id', right: 'id', label: 'Patient' }],
      adhocDimensions: [{ key: 'u1__sex', label: 'Patient Sex', join: 'u1', column: 'sex', kind: 'string' }],
      dimension: { key: 'u1__sex' },
    } as any).compile();
    expect(sql).toMatch(/left join "patients" as "u1"/i);
    expect(sql).toMatch(/"u1"\."sex" as "label"/i);
  });

  it('supports the same table joined twice under distinct aliases', () => {
    const model = getModel('service_requests')!;
    const { sql } = compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' },
      userJoins: [
        { id: 'u1', table: 'patients', left: 'patient_id', right: 'id' },
        { id: 'u2', table: 'patients', left: 'patient_id', right: 'id' },
      ],
      adhocDimensions: [
        { key: 'u1__sex', label: 'A', join: 'u1', column: 'sex', kind: 'string' },
        { key: 'u2__managing_organization', label: 'B', join: 'u2', column: 'managing_organization', kind: 'string' },
      ],
      dimension: { key: 'u1__sex' },
      filters: [{ dimension: 'u2__managing_organization', op: 'eq', value: 'Org/1' }],
    } as any).compile();
    expect(sql).toMatch(/left join "patients" as "u1"/i);
    expect(sql).toMatch(/left join "patients" as "u2"/i);
  });

  it('rejects a user join to a table not in the joinable set', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      userJoins: [{ id: 'u1', table: 'secret_table', left: 'patient_id', right: 'id' }],
      adhocDimensions: [{ key: 'u1__x', label: 'x', join: 'u1', column: 'x', kind: 'string' }],
      dimension: { key: 'u1__x' },
    } as any)).toThrow(/not joinable/i);
  });

  it('rejects selecting a denylisted (PII) column from a user join', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      userJoins: [{ id: 'u1', table: 'patients', left: 'patient_id', right: 'id' }],
      adhocDimensions: [{ key: 'u1__national_id', label: 'x', join: 'u1', column: 'national_id', kind: 'string' }],
      dimension: { key: 'u1__national_id' },
    } as any)).toThrow(/not exposable/i);
  });

  it('rejects a join key that is not a real column', () => {
    const model = getModel('service_requests')!;
    expect(() => compileBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [],
      userJoins: [{ id: 'u1', table: 'patients', left: 'evil', right: 'id' }],
      adhocDimensions: [{ key: 'u1__sex', label: 'x', join: 'u1', column: 'sex', kind: 'string' }],
      dimension: { key: 'u1__sex' },
    } as any)).toThrow(/unknown (left|right) key/i);
  });
});
