import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createConnectorStore } from './connector-store';

const key = randomBytes(32).toString('base64');
const cfg = { baseUrl: 'https://dhis2.example/dhis', username: 'admin', password: 'district' };

describe('connector store', () => {
  it('creates, lists (masking secrets), and getDecryptedConfig round-trips', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await store.create({ id: 'c1', name: 'DHIS2 Demo', pluginId: 'dhis2-sink', kind: 'sink', config: cfg, allowedHost: 'dhis2.example' }, key);

    const list = await store.list();
    expect(list.map((c) => c.id)).toEqual(['c1']);
    // list/get never expose the secret config or the ciphertext.
    expect(list[0]).not.toHaveProperty('config');
    expect(JSON.stringify(list[0])).not.toContain('district');
    expect(list[0]).toMatchObject({ name: 'DHIS2 Demo', pluginId: 'dhis2-sink', kind: 'sink', allowedHost: 'dhis2.example', enabled: true });

    expect(await store.getDecryptedConfig('c1', key)).toEqual(cfg);
    await db.destroy();
  });

  it('update replaces the sealed config + toggles enabled', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await store.create({ id: 'c1', name: 'n', pluginId: 'dhis2-sink', kind: 'sink', config: cfg }, key);

    const next = { ...cfg, password: 'rotated' };
    await store.update('c1', { config: next, enabled: false, name: 'renamed' }, key);
    expect(await store.getDecryptedConfig('c1', key)).toEqual(next);
    const r = await store.get('c1');
    expect(r).toMatchObject({ name: 'renamed', enabled: false });
    await db.destroy();
  });

  it('fails closed when the encryption key is unset on create', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await expect(store.create({ id: 'c1', name: 'n', pluginId: 'dhis2-sink', kind: 'sink', config: cfg }, undefined)).rejects.toThrow(/SECRETS_ENCRYPTION_KEY/);
    await db.destroy();
  });

  it('getDecryptedConfig throws on a wrong key', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await store.create({ id: 'c1', name: 'n', pluginId: 'dhis2-sink', kind: 'sink', config: cfg }, key);
    await expect(store.getDecryptedConfig('c1', randomBytes(32).toString('base64'))).rejects.toThrow(/decrypt/i);
    await db.destroy();
  });

  it('getDecryptedConfig throws for an unknown connector', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await expect(store.getDecryptedConfig('nope', key)).rejects.toThrow(/not found/i);
    await db.destroy();
  });

  it('update without a config patch does not require the key', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await store.create({ id: 'c1', name: 'n', pluginId: 'dhis2-sink', kind: 'sink', config: cfg }, key);
    await store.update('c1', { enabled: false }, undefined); // no secret touched ⇒ no key needed
    expect((await store.get('c1'))?.enabled).toBe(false);
    await db.destroy();
  });

  it('removes a connector', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await store.create({ id: 'c1', name: 'n', pluginId: 'dhis2-sink', kind: 'sink', config: cfg }, key);
    await store.remove('c1');
    expect(await store.list()).toEqual([]);
    await db.destroy();
  });
});

describe('connector store — host connectors', () => {
  it('creates and round-trips a host (typed, plugin-less) connector', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    const dbCfg = { host: 'db.internal', port: '5432', database: 'lab', user: 'svc', password: 's3cr3t' };
    await store.create({ id: 'h1', name: 'Lab PG', type: 'postgres', kind: 'database', config: dbCfg }, key);

    const r = await store.get('h1');
    expect(r).toMatchObject({ name: 'Lab PG', type: 'postgres', kind: 'database', pluginId: null, allowedHost: null });
    expect(JSON.stringify(r)).not.toContain('s3cr3t');
    expect(await store.getDecryptedConfig('h1', key)).toEqual(dbCfg);
    await db.destroy();
  });

  it('keeps type null for a plugin connector', async () => {
    const db = await makeMigratedDb();
    const store = createConnectorStore(db);
    await store.create({ id: 'p1', name: 'D', pluginId: 'dhis2-sink', kind: 'sink', config: cfg }, key);
    expect((await store.get('p1'))?.type).toBeNull();
    await db.destroy();
  });
});
