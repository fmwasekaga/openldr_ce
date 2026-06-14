import { describe, it, expect, vi } from 'vitest';
import { createFlatWriter } from './flat-writer';

// A minimal Patient flattens to { table: 'patients', row: {...} } (see flatten/patient.ts).
const patient = { resourceType: 'Patient', id: 'p1', gender: 'male' };

function fakeDb() {
  const exec = { execute: vi.fn(async () => undefined) };
  const insertInto = vi.fn(() => ({
    values: () => ({ onConflict: (cb: (oc: { column: () => { doUpdateSet: () => typeof exec } }) => unknown) => { cb({ column: () => ({ doUpdateSet: () => exec }) }); return exec; } }),
  }));
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
