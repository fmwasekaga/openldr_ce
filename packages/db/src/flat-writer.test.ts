import { describe, it, expect, vi } from 'vitest';
import { createFlatWriter } from './flat-writer';

// A minimal Patient flattens to { table: 'patients', row: {...} } (see flatten/patient.ts).
const patient = { resourceType: 'Patient', id: 'p1', gender: 'male' };

function fakeDb() {
  const exec = { execute: vi.fn(async () => undefined) };
  const onConflict = (cb: (oc: { column: () => { doUpdateSet: () => typeof exec } }) => unknown) => { cb({ column: () => ({ doUpdateSet: () => exec }) }); return exec; };
  const insertInto = vi.fn(() => ({ values: vi.fn(() => ({ onConflict })) }));
  const mergeInto = vi.fn(() => ({
    using: () => ({ whenMatched: () => ({ thenUpdateSet: () => ({ whenNotMatched: () => ({ thenInsertValues: () => exec }) }) }) }),
  }));
  return { db: { insertInto, mergeInto } as never, insertInto, mergeInto };
}

describe('createFlatWriter dialect branch', () => {
  it('postgres uses insertInto + onConflict', async () => {
    const { db, insertInto, mergeInto } = fakeDb();
    const w = createFlatWriter(db, 'postgres');
    expect(await w.write(patient)).toBe('written');
    expect(insertInto).toHaveBeenCalledWith('patients');
    expect(mergeInto).not.toHaveBeenCalled();
  });
  it('mssql uses mergeInto', async () => {
    const { db, insertInto, mergeInto } = fakeDb();
    const w = createFlatWriter(db, 'mssql');
    expect(await w.write(patient)).toBe('written');
    expect(mergeInto).toHaveBeenCalled();
    expect(insertInto).not.toHaveBeenCalled();
  });
  it('skips non-domain resources', async () => {
    const { db } = fakeDb();
    const w = createFlatWriter(db, 'mssql');
    expect(await w.write({ resourceType: 'Bundle', id: 'b1' })).toBe('skipped');
  });
});

describe('createFlatWriter writeMany', () => {
  const a = { resourceType: 'Patient', id: 'p1', gender: 'male' };
  const b = { resourceType: 'Patient', id: 'p2', gender: 'female' };

  it('postgres batches same-table rows into one multi-row insert per table', async () => {
    const { db, insertInto, mergeInto } = fakeDb();
    const w = createFlatWriter(db, 'postgres');
    const res = await w.writeMany([{ resource: a }, { resource: b }]);
    expect(res).toEqual(['written', 'written']);
    expect(insertInto).toHaveBeenCalledTimes(1);
    expect(insertInto).toHaveBeenCalledWith('patients');
    expect(mergeInto).not.toHaveBeenCalled();
  });

  it('skips non-domain resources and reports skipped in order', async () => {
    const { db } = fakeDb();
    const w = createFlatWriter(db, 'postgres');
    const res = await w.writeMany([{ resource: a }, { resource: { resourceType: 'Bundle', id: 'x' } }]);
    expect(res).toEqual(['written', 'skipped']);
  });

  it('mssql batches via mergeInto', async () => {
    const { db, mergeInto, insertInto } = fakeDb();
    const w = createFlatWriter(db, 'mssql');
    const res = await w.writeMany([{ resource: a }, { resource: b }]);
    expect(res).toEqual(['written', 'written']);
    expect(mergeInto).toHaveBeenCalled();
    expect(insertInto).not.toHaveBeenCalled();
  });

  it('returns an empty array for an empty batch', async () => {
    const { db } = fakeDb();
    const w = createFlatWriter(db, 'postgres');
    expect(await w.writeMany([])).toEqual([]);
  });
});
