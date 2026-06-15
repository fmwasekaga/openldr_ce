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
    it('importRows upserts (re-import updates)', async () => {
      const { s } = await store();
      await s.terms.importRows([
        { system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', properties: { class: 'ABX' } },
        { system: 'http://x', code: 'CIP', display: 'Cipro', status: 'ACTIVE', properties: null },
      ]);
      expect((await s.terms.search('http://x', { limit: 10, offset: 0 })).total).toBe(2);
      await s.terms.importRows([{ system: 'http://x', code: 'AMP', display: 'Ampicillin (updated)', status: 'DRAFT', properties: null }]);
      const page = await s.terms.search('http://x', { query: 'amp', limit: 10, offset: 0 });
      expect(page.total).toBe(1);
      expect(page.rows[0].display).toBe('Ampicillin (updated)');
      expect(page.rows[0].status).toBe('DRAFT');
    });
    it('search filters by text and status', async () => {
      const { s } = await store();
      await s.terms.create({ system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
      await s.terms.create({ system: 'http://x', code: 'CIP', display: 'Ciprofloxacin', status: 'DRAFT', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
      expect((await s.terms.search('http://x', { query: 'cipro', limit: 10, offset: 0 })).rows.map((r) => r.code)).toEqual(['CIP']);
      expect((await s.terms.search('http://x', { statuses: ['ACTIVE'], limit: 10, offset: 0 })).rows.map((r) => r.code)).toEqual(['AMP']);
    });
  });

  describe('termMappings', () => {
    it('creates a mapping, projects into concept_map_elements, and auto-creates a DRAFT target concept', async () => {
      const { db, s } = await store();
      await s.terms.create({ system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
      const res = await s.termMappings.create({ fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://loinc.org', toCode: '101477-8', toDisplay: 'Ampicillin susceptibility', mapType: 'SAME-AS', relationship: null, owner: null, isActive: true });
      expect(res.draftCreated).toBe(true);
      const proj = await db.selectFrom('concept_map_elements').selectAll().where('source_system', '=', 'http://x').where('source_code', '=', 'AMP').execute();
      expect(proj).toHaveLength(1);
      expect(proj[0].target_code).toBe('101477-8');
      expect(proj[0].equivalence).toBe('SAME-AS');
      const draft = await db.selectFrom('terminology_concepts').selectAll().where('system', '=', 'http://loinc.org').where('code', '=', '101477-8').executeTakeFirst();
      expect(draft?.status).toBe('DRAFT');
      expect(await s.termMappings.listOutgoing('http://x', 'AMP')).toHaveLength(1);
      expect(await s.termMappings.listReverse('http://loinc.org', '101477-8')).toHaveLength(1);
    });
    it('does not create a draft when the target concept already exists', async () => {
      const { s } = await store();
      await s.terms.create({ system: 'http://y', code: 'Z', display: 'Zed', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null });
      const res = await s.termMappings.create({ fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://y', toCode: 'Z', toDisplay: 'Zed', mapType: 'RELATED-TO', relationship: null, owner: null, isActive: true });
      expect(res.draftCreated).toBe(false);
    });
    it('delete removes the mapping and its projection', async () => {
      const { db, s } = await store();
      const res = await s.termMappings.create({ fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://y', toCode: 'Z', toDisplay: null, mapType: 'RELATED-TO', relationship: null, owner: null, isActive: true });
      await s.termMappings.delete(res.mapping.id);
      expect(await db.selectFrom('concept_map_elements').selectAll().where('source_code', '=', 'AMP').execute()).toHaveLength(0);
      expect(await db.selectFrom('term_mappings').selectAll().execute()).toHaveLength(0);
    });
    it('update repoints the projection', async () => {
      const { db, s } = await store();
      const res = await s.termMappings.create({ fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://y', toCode: 'Z', toDisplay: null, mapType: 'SAME-AS', relationship: null, owner: null, isActive: true });
      await s.termMappings.update(res.mapping.id, { fromSystem: 'http://x', fromCode: 'AMP', toSystem: 'http://y', toCode: 'Z2', toDisplay: 'Z2', mapType: 'NARROWER-THAN', relationship: null, owner: null, isActive: true });
      const proj = await db.selectFrom('concept_map_elements').selectAll().where('source_code', '=', 'AMP').execute();
      expect(proj).toHaveLength(1);
      expect(proj[0].target_code).toBe('Z2');
      expect(proj[0].equivalence).toBe('NARROWER-THAN');
    });
    it('throws not-found on update of a missing mapping', async () => {
      const { s } = await store();
      await expect(
        s.termMappings.update('no-such', { fromSystem: 'http://x', fromCode: 'A', toSystem: 'http://y', toCode: 'B', toDisplay: null, mapType: 'SAME-AS', relationship: null, owner: null, isActive: true }),
      ).rejects.toMatchObject({ kind: 'not-found' });
    });
  });

  describe('valueSets namespace', () => {
    it('saves (insert), expands enumerated concepts, and lists with codeCount', async () => {
      const { s: admin, db } = await store();
      await db.insertInto('terminology_concepts').values([
        { system: 's1', code: 'A', display: 'Alpha', status: 'ACTIVE', properties: null },
        { system: 's1', code: 'B', display: 'Beta', status: 'ACTIVE', properties: null },
      ] as never).execute();

      const saved = await admin.valueSets.save({
        url: 'urn:test:vs', version: null, name: null, title: 'My set', status: 'active',
        experimental: false, description: null, publisherId: 'pub-test',
        compose: { include: [{ system: 's1', concept: [{ code: 'A' }, { code: 'B' }] }] },
      });
      expect(saved.id).toMatch(/^vs-/);

      const list = await admin.valueSets.list('pub-test');
      expect(list).toHaveLength(1);
      expect(list[0]!.codeCount).toBe(2);
      expect(list[0]!.primarySystem).toBe('s1');
    });

    it('updates by url (no duplicate row) and rejects immutable edits', async () => {
      const { s: admin, db } = await store();
      const a = await admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 'v1', status: 'draft', experimental: false, description: null, compose: { include: [] } });
      const b = await admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 'v2', status: 'draft', experimental: false, description: null, compose: { include: [] } });
      expect(b.id).toBe(a.id);
      expect(await admin.valueSets.getByUrl('urn:test:vs')).toMatchObject({ id: a.id });

      await db.updateTable('value_sets').set({ immutable: true }).where('id', '=', a.id).execute();
      await expect(admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 'v3', status: 'draft', experimental: false, description: null, compose: { include: [] } }))
        .rejects.toMatchObject({ kind: 'conflict' });
    });

    it('duplicates into an editable copy', async () => {
      const { s: admin } = await store();
      const a = await admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 'orig', status: 'active', experimental: false, description: null, compose: { include: [] } });
      const dup = await admin.valueSets.duplicate(a.id);
      expect(dup.id).not.toBe(a.id);
      expect(dup.url).toBe('urn:test:vs-copy');
      expect(dup.immutable).toBe(false);
    });

    it('deletes (cascades the expansion cache)', async () => {
      const { s: admin, db } = await store();
      await db.insertInto('terminology_concepts').values([{ system: 's1', code: 'A', display: 'Alpha', status: 'ACTIVE', properties: null }] as never).execute();
      const a = await admin.valueSets.save({ url: 'urn:test:vs', version: null, name: null, title: 't', status: 'active', experimental: false, description: null, compose: { include: [{ system: 's1', concept: [{ code: 'A' }] }] } });
      await admin.valueSets.delete(a.id);
      await expect(admin.valueSets.get(a.id)).rejects.toMatchObject({ kind: 'not-found' });
      const exp = await db.selectFrom('valueset_expansions').selectAll().where('value_set_id', '=', a.id).execute();
      expect(exp).toHaveLength(0);
    });

    it('throws not-found on get/delete of a missing id', async () => {
      const { s: admin } = await store();
      await expect(admin.valueSets.get('vs-nope')).rejects.toMatchObject({ kind: 'not-found' });
      await expect(admin.valueSets.delete('vs-nope')).rejects.toMatchObject({ kind: 'not-found' });
    });
  });
});
