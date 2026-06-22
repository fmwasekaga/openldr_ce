import { describe, it, expect } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations, type InternalSchema } from '@openldr/db';
import { createTrustStore } from './trust-store';

async function makeMigratedDb(): Promise<Kysely<InternalSchema>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
  for (const migration of Object.values(internalMigrations)) {
    await migration.up(db);
  }
  return db;
}

describe('trust store', () => {
  it('pins then gets a publisher', async () => {
    const db = await makeMigratedDb();
    const store = createTrustStore(db);
    expect(await store.get('acme')).toBeUndefined();
    await store.pin({ publisherId: 'acme', keyFingerprint: 'a'.repeat(64), publisherName: 'Acme', approvedBy: 'admin' });
    expect(await store.get('acme')).toEqual({ keyFingerprint: 'a'.repeat(64) });
  });
  it('pin is idempotent on the publisher id (updates fingerprint)', async () => {
    const db = await makeMigratedDb();
    const store = createTrustStore(db);
    await store.pin({ publisherId: 'acme', keyFingerprint: 'a'.repeat(64), publisherName: 'Acme', approvedBy: null });
    await store.pin({ publisherId: 'acme', keyFingerprint: 'b'.repeat(64), publisherName: 'Acme', approvedBy: null });
    expect(await store.get('acme')).toEqual({ keyFingerprint: 'b'.repeat(64) });
  });
});
