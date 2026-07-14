import { describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import type { InternalSchema, Logger } from '@openldr/db';
import { createTerminologyBulkSync, type TerminologyBulkDeps } from './terminology-sync';
import type { ConceptsPage, MapElementsPage } from './batch';

const SYS = 'http://loinc.org';
const MAP = 'http://example.org/ConceptMap/central';

function fakeLogger(): Logger {
  return { info() {}, debug() {}, warn() {}, error() {} };
}

// Build a fetchConceptsPage from an ordered list of pages (keyed lookup by afterCode is not needed —
// the drain calls pages in order, so we just serve the next page each call).
function pagedConcepts(pages: ConceptsPage[]): (systemUrl: string, after: string | null, token: string) => Promise<ConceptsPage> {
  let i = 0;
  return async () => {
    const p = pages[i];
    i++;
    return p;
  };
}

async function conceptsFor(db: Kysely<InternalSchema>, system: string) {
  return db.selectFrom('terminology_concepts').selectAll().where('system', '=', system).orderBy('code').execute();
}

function baseDeps(db: Kysely<InternalSchema>): Omit<TerminologyBulkDeps, 'fetchConceptsPage' | 'fetchMapElementsPage'> {
  return {
    labDb: db,
    getToken: async () => 'tok',
    logger: fakeLogger(),
  };
}

describe('createTerminologyBulkSync.syncSystem', () => {
  it('drains 3 concepts across 2 pages and upserts them; stamps the system central + generation', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const deps: TerminologyBulkDeps = {
      ...baseDeps(db),
      fetchConceptsPage: pagedConcepts([
        { concepts: [
          { code: 'A', display: 'Alpha', status: 'active', properties: { a: 1 } },
          { code: 'B', display: 'Bravo', status: 'active', properties: null },
        ], nextCode: 'B' },
        { concepts: [{ code: 'C', display: 'Charlie', status: 'retired', properties: null }], nextCode: null },
      ]),
      fetchMapElementsPage: async () => ({ elements: [], nextKey: null }),
    };

    await createTerminologyBulkSync(deps).syncSystem(SYS, { version: '2.77', kind: 'CodeSystem', resourceId: 'loinc-1', generation: 5 });

    const rows = await conceptsFor(db, SYS);
    expect(rows.map((r) => r.code)).toEqual(['A', 'B', 'C']);
    const a = rows.find((r) => r.code === 'A')!;
    expect(a.display).toBe('Alpha');
    // properties round-trips as an object (jsonb) under pg-mem.
    expect(a.properties).toEqual({ a: 1 });

    const sys = await db.selectFrom('terminology_systems').selectAll().where('url', '=', SYS).executeTakeFirst();
    expect(sys?.managed_origin).toBe('central');
    expect(Number(sys?.generation)).toBe(5);
    expect(sys?.version).toBe('2.77');
    expect(sys?.kind).toBe('CodeSystem');
    expect(sys?.resource_id).toBe('loinc-1');
  });

  it('re-sync where central DROPPED one concept deletes it (whole-system reconcile); the rest remain', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const mk = (pages: ConceptsPage[]): TerminologyBulkDeps => ({
      ...baseDeps(db),
      fetchConceptsPage: pagedConcepts(pages),
      fetchMapElementsPage: async () => ({ elements: [], nextKey: null }),
    });

    // First sync: A, B, C.
    await createTerminologyBulkSync(mk([
      { concepts: [
        { code: 'A', display: 'Alpha', status: 'active', properties: null },
        { code: 'B', display: 'Bravo', status: 'active', properties: null },
        { code: 'C', display: 'Charlie', status: 'active', properties: null },
      ], nextCode: null },
    ])).syncSystem(SYS, { generation: 1 });
    expect((await conceptsFor(db, SYS)).map((r) => r.code)).toEqual(['A', 'B', 'C']);

    // Central dropped B. Re-sync now returns A, C only.
    await createTerminologyBulkSync(mk([
      { concepts: [
        { code: 'A', display: 'Alpha', status: 'active', properties: null },
        { code: 'C', display: 'Charlie2', status: 'retired', properties: null },
      ], nextCode: null },
    ])).syncSystem(SYS, { generation: 2 });

    const rows = await conceptsFor(db, SYS);
    expect(rows.map((r) => r.code)).toEqual(['A', 'C']); // B deleted
    expect(rows.find((r) => r.code === 'C')!.display).toBe('Charlie2'); // and C updated
  });

  it('leaves a lab-local system with a DIFFERENT url UNTOUCHED (only the central system is reconciled)', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const LOCAL = 'http://lab.local/custom';
    // Pre-insert a lab-local system + a concept, managed_origin NULL.
    await db.insertInto('terminology_systems').values({ url: LOCAL, version: null, kind: 'CodeSystem', resource_id: 'x', managed_origin: null } as never).execute();
    await db.insertInto('terminology_concepts').values({ system: LOCAL, code: 'LOC1', display: 'Local one', status: 'active', properties: null } as never).execute();

    const deps: TerminologyBulkDeps = {
      ...baseDeps(db),
      fetchConceptsPage: pagedConcepts([{ concepts: [{ code: 'A', display: 'Alpha', status: 'active', properties: null }], nextCode: null }]),
      fetchMapElementsPage: async () => ({ elements: [], nextKey: null }),
    };
    await createTerminologyBulkSync(deps).syncSystem(SYS, { generation: 1 });

    // Central system reconciled...
    expect((await conceptsFor(db, SYS)).map((r) => r.code)).toEqual(['A']);
    // ...but the lab-local system is completely untouched.
    const localRows = await conceptsFor(db, LOCAL);
    expect(localRows.map((r) => r.code)).toEqual(['LOC1']);
    const localSys = await db.selectFrom('terminology_systems').selectAll().where('url', '=', LOCAL).executeTakeFirst();
    expect(localSys?.managed_origin).toBeNull();
  });

  it('empty pull deletes ALL of the system\'s concepts (system emptied) and still stamps it central', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    // Seed via a first sync.
    await createTerminologyBulkSync({
      ...baseDeps(db),
      fetchConceptsPage: pagedConcepts([{ concepts: [
        { code: 'A', display: 'Alpha', status: 'active', properties: null },
        { code: 'B', display: 'Bravo', status: 'active', properties: null },
      ], nextCode: null }]),
      fetchMapElementsPage: async () => ({ elements: [], nextKey: null }),
    }).syncSystem(SYS, { generation: 1 });
    expect((await conceptsFor(db, SYS)).length).toBe(2);

    // Empty pull.
    await createTerminologyBulkSync({
      ...baseDeps(db),
      fetchConceptsPage: pagedConcepts([{ concepts: [], nextCode: null }]),
      fetchMapElementsPage: async () => ({ elements: [], nextKey: null }),
    }).syncSystem(SYS, { generation: 2 });

    expect((await conceptsFor(db, SYS)).length).toBe(0); // all deleted
    const sys = await db.selectFrom('terminology_systems').selectAll().where('url', '=', SYS).executeTakeFirst();
    expect(sys?.managed_origin).toBe('central');
    expect(Number(sys?.generation)).toBe(2);
  });

  it('a page-fetch that THROWS on page 2 leaves the lab untouched (drain-before-txn: no partial apply) and propagates', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    // Pre-seed a concept so we can prove NOTHING changed on a mid-drain failure.
    await db.insertInto('terminology_concepts').values({ system: SYS, code: 'PRE', display: 'preexisting', status: 'active', properties: null } as never).execute();

    let calls = 0;
    const deps: TerminologyBulkDeps = {
      ...baseDeps(db),
      fetchConceptsPage: async () => {
        calls++;
        if (calls === 1) return { concepts: [{ code: 'A', display: 'Alpha', status: 'active', properties: null }], nextCode: 'A' };
        throw new Error('page 2 fetch failed');
      },
      fetchMapElementsPage: async () => ({ elements: [], nextKey: null }),
    };

    await expect(createTerminologyBulkSync(deps).syncSystem(SYS, { generation: 1 })).rejects.toThrow('page 2 fetch failed');

    // The reconcile transaction never ran: the pre-existing concept is intact, 'A' was NOT upserted,
    // and the system row was NOT stamped central.
    const rows = await conceptsFor(db, SYS);
    expect(rows.map((r) => r.code)).toEqual(['PRE']);
    const sys = await db.selectFrom('terminology_systems').selectAll().where('url', '=', SYS).executeTakeFirst();
    expect(sys).toBeUndefined();
  });
});

describe('createTerminologyBulkSync.syncConceptMap', () => {
  it('whole-map replace: pre-existing elements are replaced by the pulled set; concept_map_state stamped central', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    // Pre-existing element for the map that must be REMOVED by the replace.
    await db.insertInto('concept_map_elements').values({ map_url: MAP, source_system: 's', source_code: 'OLD', target_system: 't', target_code: 'oldT', equivalence: 'equal' } as never).execute();

    const pages: MapElementsPage[] = [
      { elements: [{ sourceSystem: 's', sourceCode: 'N1', targetSystem: 't', targetCode: 'x1', equivalence: 'equal' }], nextKey: { sourceSystem: 's', sourceCode: 'N1' } },
      { elements: [{ sourceSystem: 's', sourceCode: 'N2', targetSystem: 't', targetCode: 'x2', equivalence: 'wider' }], nextKey: null },
    ];
    let i = 0;
    const deps: TerminologyBulkDeps = {
      ...baseDeps(db),
      fetchConceptsPage: async () => ({ concepts: [], nextCode: null }),
      fetchMapElementsPage: async () => pages[i++],
    };

    await createTerminologyBulkSync(deps).syncConceptMap(MAP, { generation: 9 });

    const els = await db.selectFrom('concept_map_elements').selectAll().where('map_url', '=', MAP).orderBy('source_code').execute();
    expect(els.map((e) => e.source_code)).toEqual(['N1', 'N2']); // OLD gone, pulled set present
    const state = await db.selectFrom('concept_map_state').selectAll().where('map_url', '=', MAP).executeTakeFirst();
    expect(state?.managed_origin).toBe('central');
    expect(Number(state?.generation)).toBe(9);
  });
});
