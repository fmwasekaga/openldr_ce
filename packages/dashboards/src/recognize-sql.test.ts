import { describe, it, expect } from 'vitest';
import { recognizeSql } from './recognize-sql';

describe('recognizeSql — core shape', () => {
  it('recognizes a plain COUNT(*) KPI', () => {
    const r = recognizeSql('SELECT COUNT(*) AS value FROM lab_requests');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.query).toMatchObject({ mode: 'builder', model: 'service_requests', metric: { key: 'count', agg: 'count' }, filters: [] });
  });

  it('maps COUNT(DISTINCT patient_id) to the model metric', () => {
    const r = recognizeSql('SELECT COUNT(DISTINCT patient_id) AS value FROM lab_requests');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.query.metric).toMatchObject({ key: 'distinct_subjects', agg: 'count_distinct' });
  });

  it('recognizes a group-by dimension', () => {
    const r = recognizeSql('SELECT status AS label, COUNT(*) AS value FROM lab_requests GROUP BY status');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.query.dimension).toEqual({ key: 'status' });
  });

  it('maps substring(col,1,10) group-by to a day-grain date dimension', () => {
    const r = recognizeSql('SELECT substring(authored_at,1,10) AS label, COUNT(*) AS value FROM lab_requests GROUP BY substring(authored_at,1,10)');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.query.dimension).toEqual({ key: 'authored_on', grain: 'day' });
  });

  it('refuses an unknown table with a code', () => {
    const r = recognizeSql('SELECT COUNT(*) AS value FROM secret_table');
    expect(r).toMatchObject({ ok: false, code: 'unknown_table' });
  });

  it('refuses multiple measures (v1 capability invariant)', () => {
    const r = recognizeSql('SELECT observation_desc AS label, COUNT(*) AS x, AVG(numeric_value) AS y FROM lab_results GROUP BY observation_desc');
    expect(r).toMatchObject({ ok: false, code: 'multi_measure' });
  });

  it('refuses a detail row list (no aggregate)', () => {
    const r = recognizeSql('SELECT request_id AS order_id, status FROM lab_requests');
    expect(r).toMatchObject({ ok: false, code: 'detail_rows' });
  });
});
