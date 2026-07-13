import { describe, it, expect, vi } from 'vitest';
import { insertBatchPg, mergeBatchMssql, insertBatchMysql } from './batch-upsert';

// A fake Kysely that records which query builder each batch primitive dispatches to (insertInto vs
// mergeInto) and how many statements it issues, without a real DB. The real `sql` template helpers
// used inside mergeBatchMssql/insertBatchMysql build query fragments standalone, so they work here.
// `table` is a plain string (these primitives take `table: string`, no schema types), and rows are
// plain records — exactly the shape relational-writer's `upsert()` passes them.
function fakeDb() {
  const exec = { execute: vi.fn(async () => undefined) };
  const onConflict = vi.fn((cb: (oc: { column: () => { doUpdateSet: () => typeof exec } }) => unknown) => {
    cb({ column: () => ({ doUpdateSet: () => exec }) });
    return exec;
  });
  const onDuplicateKeyUpdate = vi.fn(() => exec);
  const values = vi.fn(() => ({ onConflict, onDuplicateKeyUpdate }));
  const insertInto = vi.fn(() => ({ values }));
  const mergeInto = vi.fn(() => ({
    using: () => ({ whenMatched: () => ({ thenUpdateSet: () => ({ whenNotMatched: () => ({ thenInsertValues: () => exec }) }) }) }),
  }));
  return { db: { insertInto, mergeInto } as never, insertInto, mergeInto, onConflict, onDuplicateKeyUpdate };
}

const rows = [
  { id: 'p1', gender: 'male', source_system: 's', batch_id: 'b1' },
  { id: 'p2', gender: 'female', source_system: 's', batch_id: 'b1' },
];

describe('batch-upsert dialect dispatch', () => {
  it('insertBatchPg uses insertInto + onConflict (not mergeInto / onDuplicateKeyUpdate)', async () => {
    const { db, insertInto, mergeInto, onConflict, onDuplicateKeyUpdate } = fakeDb();
    await insertBatchPg(db, 'lab_results', rows);
    expect(insertInto).toHaveBeenCalledWith('lab_results');
    expect(onConflict).toHaveBeenCalled();
    expect(onDuplicateKeyUpdate).not.toHaveBeenCalled();
    expect(mergeInto).not.toHaveBeenCalled();
  });

  it('mergeBatchMssql uses mergeInto (not insertInto)', async () => {
    const { db, insertInto, mergeInto } = fakeDb();
    await mergeBatchMssql(db, 'lab_results', rows);
    expect(mergeInto).toHaveBeenCalled();
    expect(insertInto).not.toHaveBeenCalled();
  });

  it('insertBatchMysql uses insertInto + onDuplicateKeyUpdate (not onConflict / merge)', async () => {
    const { db, insertInto, mergeInto, onConflict, onDuplicateKeyUpdate } = fakeDb();
    await insertBatchMysql(db, 'lab_results', rows);
    expect(insertInto).toHaveBeenCalledWith('lab_results');
    expect(onDuplicateKeyUpdate).toHaveBeenCalled();
    expect(onConflict).not.toHaveBeenCalled();
    expect(mergeInto).not.toHaveBeenCalled();
  });

  it('each primitive is a no-op (no statement) for an empty batch', async () => {
    const { db, insertInto, mergeInto } = fakeDb();
    await insertBatchPg(db, 'lab_results', []);
    await mergeBatchMssql(db, 'lab_results', []);
    await insertBatchMysql(db, 'lab_results', []);
    expect(insertInto).not.toHaveBeenCalled();
    expect(mergeInto).not.toHaveBeenCalled();
  });

  it('pg batches same-table rows into a single multi-row insert', async () => {
    const { db, insertInto } = fakeDb();
    await insertBatchPg(db, 'lab_results', rows);
    expect(insertInto).toHaveBeenCalledTimes(1);
  });
});

// SQL Server caps a statement at 2100 parameters (params = rows x columns). A fixed row cap silently
// overflowed for large batches and the whole MERGE failed. The param-budget chunker (chunkSize) must
// split a large batch into several MERGE statements while Postgres's far-higher budget keeps the same
// batch in one INSERT. These two tests are the named regression for that 2100-param ceiling bug — they
// assert on statement COUNT, so a broken chunkSize (fixed/ignored budget) makes them fail, not pass.
describe('param-budget chunking regression', () => {
  // 4 columns/row → mssql step = floor(2000/4) = 500, so 800 rows split into 2 MERGE statements;
  // pg step = floor(60000/4) = 15000, so 800 rows stay in a single INSERT.
  const manyRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, gender: i % 2 ? 'male' : 'female', source_system: 's', batch_id: 'b1' }));

  it('mssql splits a large batch into multiple MERGE statements (param budget)', async () => {
    const { db, mergeInto } = fakeDb();
    await mergeBatchMssql(db, 'lab_results', manyRows(800));
    expect(mergeInto.mock.calls.length).toBeGreaterThan(1); // chunked, not one over-limit statement
  });

  it('postgres keeps a large batch in a single insert (high param budget)', async () => {
    const { db, insertInto } = fakeDb();
    await insertBatchPg(db, 'lab_results', manyRows(800));
    expect(insertInto).toHaveBeenCalledTimes(1); // 800 rows x 4 cols is well under 60000 params
  });
});
