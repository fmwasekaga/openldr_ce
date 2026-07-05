import { describe, it, expect } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import { compileBuilderQuery } from './compile';
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
    expect(sql).toContain('from "service_requests"');
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
    expect(sql).toContain('"code_text"');
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
      metric: { key: 'x', agg: agg as any, column: 'value_quantity', where: [{ dimension: 'status', op: 'eq', value: 'final' }] },
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
