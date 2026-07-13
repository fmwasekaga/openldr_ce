import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { runBuilderQuery } from './compile';
import { getModel } from './models/registry';

describe('runBuilderQuery breakdown', () => {
  it('shapes long [label, series, value] rows', async () => {
    const mem = newDb();
    mem.public.none('create table lab_requests (status text, panel_desc text, priority text, authored_at text, patient_id text)');
    mem.public.none("insert into lab_requests (status, panel_desc) values ('active','A'),('active','B'),('done','A')");
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const model = getModel('service_requests')!;
    const res = await runBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' },
      dimension: { key: 'status' }, breakdown: { key: 'code_text' }, filters: [],
    });
    expect(res.columns.map((c) => c.key)).toEqual(['label', 'series', 'value']);
    expect(res.rows.length).toBe(3);
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'active', series: 'A', value: 1 }));
  });

  it('keeps multi-word series names intact with a date dimension + grain', async () => {
    const mem = newDb();
    mem.public.none('create table lab_requests (status text, panel_desc text, priority text, authored_at text, patient_id text)');
    mem.public.none("insert into lab_requests (authored_at, panel_desc) values ('2024-01-05','Emergency Room'),('2024-01-12','Emergency Room'),('2024-02-03','Emergency Room')");
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const model = getModel('service_requests')!;
    const res = await runBuilderQuery(db, model, {
      mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' },
      dimension: { key: 'authored_on', grain: 'month' }, breakdown: { key: 'code_text' }, filters: [],
    });
    // series must be the FULL 'Emergency Room', not just 'Emergency'
    expect(res.rows.every((r) => r.series === 'Emergency Room')).toBe(true);
    expect(res.rows.map((r) => r.label).sort()).toEqual(['2024-01', '2024-02']);
  });
});

describe('runBuilderQuery wide mode (Slice A)', () => {
  function memObs() {
    const mem = newDb();
    mem.public.none('create table lab_results (observation_desc text, abnormal_flag text, numeric_units text, numeric_value float, result_timestamp text, patient_id text)');
    return mem;
  }

  it('reproduces the amr-resistance R/I/S/tested pivot as columns', async () => {
    const mem = memObs();
    // Cipro: 2R 1I 1S ; Genta: 1R 0I 2S
    mem.public.none(`insert into lab_results (observation_desc, abnormal_flag) values
      ('Ciprofloxacin','R'),('Ciprofloxacin','R'),('Ciprofloxacin','I'),('Ciprofloxacin','S'),
      ('Gentamicin','R'),('Gentamicin','S'),('Gentamicin','S')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const model = getModel('observations')!;
    const res = await runBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'tested', agg: 'count' },
      metrics: [
        { key: 'tested', label: 'Tested', agg: 'count' },
        { key: 'r', label: 'R', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
        { key: 'i', label: 'I', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'I' }] },
        { key: 's', label: 'S', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'S' }] },
      ],
      dimension: { key: 'code_text' },
      filters: [{ dimension: 'interpretation_code', op: 'in', value: ['R', 'I', 'S'] }],
    });
    expect(res.columns.map((c) => c.key)).toEqual(['label', 'tested', 'r', 'i', 's']);
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'Ciprofloxacin', tested: 4, r: 2, i: 1, s: 1 }));
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'Gentamicin', tested: 3, r: 1, i: 0, s: 2 }));
  });

  it('returns a single summary row with each metric when there is no dimension', async () => {
    const mem = memObs();
    mem.public.none(`insert into lab_results (abnormal_flag) values ('R'),('R'),('S')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const model = getModel('observations')!;
    const res = await runBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'tested', agg: 'count' },
      metrics: [
        { key: 'tested', agg: 'count' },
        { key: 'r', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
      ],
      filters: [],
    });
    expect(res.rows.length).toBe(1);
    expect(res.rows[0]).toEqual(expect.objectContaining({ tested: 3, r: 2 }));
  });

  it('sums each metric column per grain bucket for a date dimension', async () => {
    const mem = memObs();
    mem.public.none(`insert into lab_results (result_timestamp, abnormal_flag) values
      ('2024-01-05','R'),('2024-01-20','S'),('2024-02-03','R')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const model = getModel('observations')!;
    const res = await runBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'total', agg: 'count' },
      metrics: [
        { key: 'total', agg: 'count' },
        { key: 'r', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
      ],
      dimension: { key: 'effective_date_time', grain: 'month' }, filters: [],
    });
    expect(res.rows.map((r) => r.label).sort()).toEqual(['2024-01', '2024-02']);
    expect(res.rows).toContainEqual(expect.objectContaining({ label: '2024-01', total: 2, r: 1 }));
    expect(res.rows).toContainEqual(expect.objectContaining({ label: '2024-02', total: 1, r: 1 }));
  });
});

describe('runBuilderQuery derived ratio (Slice B)', () => {
  function memObs() {
    const mem = newDb();
    mem.public.none('create table lab_results (observation_desc text, abnormal_flag text, numeric_units text, numeric_value float, result_timestamp text, patient_id text)');
    return mem;
  }

  it('computes %R as a derived ratio metric (completes amr-resistance)', async () => {
    const mem = memObs();
    mem.public.none(`insert into lab_results (observation_desc, abnormal_flag) values
      ('Ciprofloxacin','R'),('Ciprofloxacin','R'),('Ciprofloxacin','I'),('Ciprofloxacin','S'),
      ('Gentamicin','R'),('Gentamicin','S'),('Gentamicin','S')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const model = getModel('observations')!;
    const res = await runBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'tested', agg: 'count' },
      metrics: [
        { key: 'tested', label: 'Tested', agg: 'count' },
        { key: 'r', label: 'R', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
        { key: 'percentR', label: '%R', agg: 'count', derived: { numerator: 'r', denominator: 'tested', scale: 100, decimals: 1 } },
      ],
      dimension: { key: 'code_text' },
      filters: [{ dimension: 'interpretation_code', op: 'in', value: ['R', 'I', 'S'] }],
    });
    expect(res.columns.map((c) => c.key)).toEqual(['label', 'tested', 'r', 'percentR']);
    expect(res.columns.find((c) => c.key === 'percentR')?.kind).toBe('percent');
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'Ciprofloxacin', tested: 4, r: 2, percentR: 50 }));
    expect(res.rows).toContainEqual(expect.objectContaining({ label: 'Gentamicin', tested: 3, r: 1, percentR: 33.3 }));
  });

  it('returns 0 for a derived ratio when the denominator is 0', async () => {
    const mem = memObs();
    mem.public.none(`insert into lab_results (abnormal_flag) values ('S'),('S')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const model = getModel('observations')!;
    const res = await runBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'r', agg: 'count' },
      metrics: [
        { key: 'r', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
        { key: 'i', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'I' }] },
        { key: 'ratio', agg: 'count', derived: { numerator: 'r', denominator: 'i', scale: 100, decimals: 1 } },
      ],
      filters: [],
    });
    expect(res.rows[0]).toEqual(expect.objectContaining({ r: 0, i: 0, ratio: 0 }));
  });

  it('carries the derived metric decimals onto its result column', async () => {
    const mem = memObs();
    mem.public.none(`insert into lab_results (abnormal_flag) values ('R'),('R'),('S')`);
    const db = mem.adapters.createKysely() as unknown as import('kysely').Kysely<any>;
    const model = getModel('observations')!;
    const res = await runBuilderQuery(db, model, {
      mode: 'builder', model: 'observations',
      metric: { key: 'tested', agg: 'count' },
      metrics: [
        { key: 'tested', agg: 'count' },
        { key: 'r', agg: 'count', where: [{ dimension: 'interpretation_code', op: 'eq', value: 'R' }] },
        { key: 'pct', agg: 'count', derived: { numerator: 'r', denominator: 'tested', scale: 100, decimals: 2 } },
      ],
      filters: [],
    });
    expect(res.columns.find((c) => c.key === 'pct')?.decimals).toBe(2);
    expect(res.columns.find((c) => c.key === 'tested')?.decimals).toBeUndefined();
  });
});
