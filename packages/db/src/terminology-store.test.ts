import { describe, it, expect } from 'vitest';
import { createTerminologyStore } from './terminology-store';
import { createFhirStore } from './fhir-store';
import { makeMigratedDb } from './migrations/internal/test-helpers';

describe('searchConcepts', () => {
  async function seeded() {
    const db = await makeMigratedDb();
    const store = createTerminologyStore(db as never, createFhirStore(db as never));
    await store.upsertConcepts([
      { system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', properties: null },
      { system: 'http://x', code: 'CIP', display: 'Ciprofloxacin', status: 'DRAFT', properties: null },
      { system: 'http://x', code: 'GEN', display: 'Gentamicin', status: 'ACTIVE', properties: null },
    ]);
    return { db, store };
  }
  it('filters by text on code or display (case-insensitive)', async () => {
    const { store } = await seeded();
    const rows = await store.searchConcepts({ systemUrl: 'http://x', query: 'cipro', limit: 10, offset: 0 });
    expect(rows.map((r) => r.code)).toEqual(['CIP']);
  });
  it('filters by status and counts', async () => {
    const { store } = await seeded();
    const rows = await store.searchConcepts({ systemUrl: 'http://x', statuses: ['ACTIVE'], limit: 10, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['AMP', 'GEN']);
    expect(await store.countConceptsSearch({ systemUrl: 'http://x', statuses: ['ACTIVE'] })).toBe(2);
  });
  it('pages results ordered by code', async () => {
    const { store } = await seeded();
    const page1 = await store.searchConcepts({ systemUrl: 'http://x', limit: 2, offset: 0 });
    expect(page1.map((r) => r.code)).toEqual(['AMP', 'CIP']);
    const page2 = await store.searchConcepts({ systemUrl: 'http://x', limit: 2, offset: 2 });
    expect(page2.map((r) => r.code)).toEqual(['GEN']);
  });
});
