import { describe, it, expect } from 'vitest';
import { Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations } from './migrations/internal/index';
import { createTerminologyAdminStore, TerminologyAdminError } from './terminology-admin-store';
import type { InternalSchema } from './schema/internal';

// Same pg-mem migrated-db construction as 012_terminology_admin.test.ts.
// The migration seeds 6 publishers and backfills any existing terminology_concepts rows;
// the test db starts empty of concepts so no coding_systems rows exist at boot.
async function makeMigratedDb(): Promise<Kysely<InternalSchema>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
  for (const migration of Object.values(internalMigrations)) {
    await (migration as { up: (db: Kysely<unknown>) => Promise<void> }).up(db as Kysely<unknown>);
  }
  return db;
}

describe('terminology admin store', () => {
  async function store() {
    const db = await makeMigratedDb();
    return { db, s: createTerminologyAdminStore(db) };
  }

  it('lists the seeded publishers ordered by sort_order', async () => {
    const { s } = await store();
    const pubs = await s.publishers.list();
    expect(pubs[0].name).toBe('System');
    expect(pubs.find((p) => p.name === 'LOINC')?.role).toBe('external');
  });

  it('creates, updates, and deletes a custom publisher', async () => {
    const { s } = await store();
    const p = await s.publishers.create({ name: 'My Lab', role: 'local', icon: '🧪' });
    expect(p.seeded).toBe(false);
    const u = await s.publishers.update(p.id, { name: 'My Lab 2', role: 'external', icon: null });
    expect(u.name).toBe('My Lab 2');
    await s.publishers.delete(p.id);
    expect((await s.publishers.list()).find((x) => x.id === p.id)).toBeUndefined();
  });

  it('refuses to delete a seeded publisher', async () => {
    const { s } = await store();
    const loinc = (await s.publishers.list()).find((p) => p.name === 'LOINC')!;
    await expect(s.publishers.delete(loinc.id)).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('rejects a duplicate code-system url with a conflict', async () => {
    const { s } = await store();
    await s.codingSystems.create({ systemCode: 'A', systemName: 'A', url: 'http://dup.org', active: true, publisherId: null });
    await expect(
      s.codingSystems.create({ systemCode: 'B', systemName: 'B', url: 'http://dup.org', active: true, publisherId: null }),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('updates a code system but keeps system_code immutable, and 404s on missing', async () => {
    const { s } = await store();
    const sys = await s.codingSystems.create({ systemCode: 'ORIG', systemName: 'orig', active: true, publisherId: null });
    const u = await s.codingSystems.update(sys.id, { systemCode: 'IGNORED', systemName: 'renamed', url: 'http://u.org', active: false, publisherId: null });
    expect(u.systemCode).toBe('ORIG'); // immutable
    expect(u.systemName).toBe('renamed');
    await expect(s.codingSystems.update('no-such', { systemCode: 'X', systemName: 'X', active: true, publisherId: null })).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('creates a code system and reports deletion impact', async () => {
    const { db, s } = await store();
    const sys = await s.codingSystems.create({ systemCode: 'X', systemName: 'X system', url: 'http://x.org', active: true, publisherId: null });
    await db.insertInto('terminology_concepts').values([
      { system: 'http://x.org', code: 'a', display: 'A', status: null, properties: null },
      { system: 'http://x.org', code: 'b', display: 'B', status: null, properties: null },
    ]).execute();
    const impact = await s.codingSystems.deletionImpact(sys.id);
    expect(impact.termCount).toBe(2);
  });

  it('upserts a coding system by url (idempotent, updates name)', async () => {
    const { s } = await store();
    await s.codingSystems.upsertByUrl({ url: 'http://loinc.org', systemCode: 'LOINC', systemName: 'LOINC v1', publisherId: 'pub-loinc' });
    await s.codingSystems.upsertByUrl({ url: 'http://loinc.org', systemCode: 'LOINC', systemName: 'LOINC v2', publisherId: 'pub-loinc' });
    const rows = (await s.codingSystems.list()).filter((c) => c.url === 'http://loinc.org');
    expect(rows).toHaveLength(1);
    expect(rows[0].systemName).toBe('LOINC v2');
  });

  describe('terms', () => {
    it('creates a term with structured properties and reads them back', async () => {
      const { s } = await store();
      const t = await s.terms.create({ system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', shortName: 'Amp', class: 'ABX', unit: null, replacedBy: null, metadata: { rxnorm: '1' } });
      expect(t.shortName).toBe('Amp');
      expect(t.class).toBe('ABX');
      const page = await s.terms.search('http://x', { limit: 10, offset: 0 });
      expect(page.total).toBe(1);
      expect(page.rows[0].metadata).toEqual({ rxnorm: '1' });
      expect(page.rows[0].mappingCount).toBe(0);
    });
    it('updates and deletes a term', async () => {
      const { s } = await store();
      await s.terms.create({ system: 'http://x', code: 'AMP', display: 'A', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
      const u = await s.terms.update('http://x', 'AMP', { system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'DRAFT', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
      expect(u.display).toBe('Ampicillin');
      expect(u.status).toBe('DRAFT');
      await s.terms.delete('http://x', 'AMP');
      expect((await s.terms.search('http://x', { limit: 10, offset: 0 })).total).toBe(0);
    });
    it('throws not-found on update/delete of a missing term', async () => {
      const { s } = await store();
      await expect(
        s.terms.update('http://x', 'NOPE', { system: 'http://x', code: 'NOPE', display: 'x', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null }),
      ).rejects.toMatchObject({ kind: 'not-found' });
      await expect(s.terms.delete('http://x', 'NOPE')).rejects.toMatchObject({ kind: 'not-found' });
    });
    it('search filters by text and status', async () => {
      const { s } = await store();
      await s.terms.create({ system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
      await s.terms.create({ system: 'http://x', code: 'CIP', display: 'Ciprofloxacin', status: 'DRAFT', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
      expect((await s.terms.search('http://x', { query: 'cipro', limit: 10, offset: 0 })).rows.map((r) => r.code)).toEqual(['CIP']);
      expect((await s.terms.search('http://x', { statuses: ['ACTIVE'], limit: 10, offset: 0 })).rows.map((r) => r.code)).toEqual(['AMP']);
    });
  });
});
