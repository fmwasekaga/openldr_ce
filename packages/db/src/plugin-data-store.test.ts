import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import type { InternalSchema } from './schema/internal';
import { createPluginDataStore } from './plugin-data-store';

describe('plugin-data store', () => {
  let db: Kysely<InternalSchema>;
  beforeEach(async () => { db = await makeMigratedDb(); });

  it('put/get round-trips a doc, scoped by plugin id', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', 'mappings', 'k1', { a: 1 });
    expect(await s.get('p1', 'mappings', 'k1')).toEqual({ a: 1 });
    expect(await s.get('p2', 'mappings', 'k1')).toBeNull(); // namespacing
  });

  it('put upserts (second write to same key replaces)', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', 'c', 'k', { v: 1 });
    await s.put('p1', 'c', 'k', { v: 2 });
    expect(await s.get('p1', 'c', 'k')).toEqual({ v: 2 });
  });

  it('list returns a collection, with optional equality filter + limit', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', 'c', 'a', { type: 'x', n: 1 });
    await s.put('p1', 'c', 'b', { type: 'y', n: 2 });
    await s.put('p1', 'c', 'd', { type: 'x', n: 3 });
    const all = await s.list('p1', 'c');
    expect(all.length).toBe(3);
    const xs = await s.list('p1', 'c', { where: { field: 'type', eq: 'x' } });
    expect(xs.map((e) => e.key).sort()).toEqual(['a', 'd']);
    const limited = await s.list('p1', 'c', { limit: 1 });
    expect(limited.length).toBe(1);
  });

  it('delete removes one key; purge removes a whole namespace', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', 'c', 'a', { n: 1 });
    await s.put('p1', 'c', 'b', { n: 2 });
    await s.delete('p1', 'c', 'a');
    expect(await s.get('p1', 'c', 'a')).toBeNull();
    await s.put('p2', 'c', 'a', { n: 9 });
    await s.purge('p1');
    expect(await s.list('p1', 'c')).toEqual([]);
    expect(await s.get('p2', 'c', 'a')).toEqual({ n: 9 }); // other namespace untouched
  });

  it('rejects an invalid filter field name', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', 'c', 'a', { type: 'x' });
    await expect(s.list('p1', 'c', { where: { field: 'type; DROP', eq: 'x' } })).rejects.toThrow();
  });

  it('rejects an empty filter field name', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', 'c', 'a', { type: 'x' });
    await expect(s.list('p1', 'c', { where: { field: '', eq: 'x' } })).rejects.toThrow();
  });

  it('rejects a non-ascii filter field name', async () => {
    const s = createPluginDataStore(db);
    await s.put('p1', 'c', 'a', { type: 'x' });
    await expect(s.list('p1', 'c', { where: { field: 'typé', eq: 'x' } })).rejects.toThrow();
  });
});
