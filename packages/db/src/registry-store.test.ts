import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createRegistryStore } from './registry-store';

describe('createRegistryStore', () => {
  it('creates/lists/gets/updates/removes', async () => {
    const db = await makeMigratedDb();
    const store = createRegistryStore(db);

    await store.create({ id: 'r1', name: 'Public', kind: 'http', location: 'https://example.org/reg' });
    await store.create({ id: 'r2', name: 'Local dir', kind: 'local', location: '/srv/bundles', enabled: false });

    const list = await store.list();
    expect(list.map((r) => r.id).sort()).toEqual(['r1', 'r2']);

    const r1 = await store.get('r1');
    expect(r1).not.toBeNull();
    expect(r1!.kind).toBe('http');
    expect(r1!.enabled).toBe(true);
    expect(r1!.createdAt).toBeInstanceOf(Date);

    const r2 = await store.get('r2');
    expect(r2!.enabled).toBe(false);

    await store.update('r1', { enabled: false, name: 'Public (off)' });
    const r1Updated = await store.get('r1');
    expect(r1Updated!.enabled).toBe(false);
    expect(r1Updated!.name).toBe('Public (off)');

    await store.remove('r2');
    expect(await store.get('r2')).toBeNull();

    const listAfter = await store.list();
    expect(listAfter.map((r) => r.id)).toEqual(['r1']);

    await db.destroy();
  });

  it('update patches only specified fields', async () => {
    const db = await makeMigratedDb();
    const store = createRegistryStore(db);
    await store.create({ id: 'r1', name: 'Orig', kind: 'http', location: 'https://a.example' });
    await store.update('r1', { location: 'https://b.example' });
    const r = await store.get('r1');
    expect(r!.name).toBe('Orig');
    expect(r!.location).toBe('https://b.example');
    await db.destroy();
  });
});
