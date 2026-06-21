import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import { testVolume } from './test-volume';

type Row = { code_text: string | null; authored_on: string };

// Minimal chainable fake of the Kysely query builder used by testVolume.run:
// selectFrom(...).select(...).where(...)?.execute() -> rows.
function fakeDb(rows: Row[]): Kysely<ExternalSchema> {
  const builder = {
    select: () => builder,
    where: () => builder,
    execute: async () => rows,
  };
  return { selectFrom: () => builder } as unknown as Kysely<ExternalSchema>;
}

describe('testVolume', () => {
  it('preserves multi-word test names (no truncation at the first space)', async () => {
    const db = fakeDb([
      { code_text: 'Blood culture', authored_on: '2026-01-05' },
      { code_text: 'Blood culture', authored_on: '2026-01-20' },
      { code_text: 'Urine culture', authored_on: '2026-01-12' },
    ]);
    const result = await testVolume.run(db, {});
    const blood = result.rows.find((r) => r.month === '2026-01' && r.test === 'Blood culture');
    const urine = result.rows.find((r) => r.month === '2026-01' && r.test === 'Urine culture');
    expect(blood).toEqual({ month: '2026-01', test: 'Blood culture', count: 2 });
    expect(urine).toEqual({ month: '2026-01', test: 'Urine culture', count: 1 });
    // Nothing got truncated to a bare first word.
    expect(result.rows.map((r) => r.test)).not.toContain('Blood');
    expect(result.rows.map((r) => r.test)).not.toContain('Urine');
  });

  it('groups counts by month and test, with null code_text as (unknown)', async () => {
    const db = fakeDb([
      { code_text: 'Blood culture', authored_on: '2026-01-05' },
      { code_text: 'Blood culture', authored_on: '2026-02-05' },
      { code_text: null, authored_on: '2026-02-09' },
    ]);
    const result = await testVolume.run(db, {});
    expect(result.rows).toHaveLength(3);
    expect(result.rows).toContainEqual({ month: '2026-01', test: 'Blood culture', count: 1 });
    expect(result.rows).toContainEqual({ month: '2026-02', test: 'Blood culture', count: 1 });
    expect(result.rows).toContainEqual({ month: '2026-02', test: '(unknown)', count: 1 });
    // Months are sorted ascending.
    expect(result.rows[0].month).toBe('2026-01');
  });
});
