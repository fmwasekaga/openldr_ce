import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { runBuilderQuery } from './compile';
import { getModel } from './models/registry';

describe('runBuilderQuery breakdown', () => {
  it('shapes long [label, series, value] rows', async () => {
    const mem = newDb();
    mem.public.none('create table service_requests (status text, code_text text, priority text, authored_on text, subject_ref text)');
    mem.public.none("insert into service_requests (status, code_text) values ('active','A'),('active','B'),('done','A')");
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
});
