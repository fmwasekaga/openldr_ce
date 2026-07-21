import { describe, it, expect } from 'vitest';
import { resolveCodingSystemId } from './terminology-ingest-shared';

function fakeAdmin(existing: Record<string, { id: string }>) {
  const upserts: unknown[] = [];
  const store = { ...existing };
  const admin = {
    codingSystems: {
      async getByUrl(url: string) { return store[url] ?? null; },
      async upsertByUrl(input: { url: string }) {
        upserts.push(input);
        store[input.url] = { id: `cs_${Object.keys(store).length}` };
      },
    },
  } as never;
  return { admin, upserts };
}

describe('resolveCodingSystemId', () => {
  it('creates the coding system by canonical URL when absent (snomed → .../sct)', async () => {
    const { admin, upserts } = fakeAdmin({});
    const id = await resolveCodingSystemId(admin, 'snomed', '2026-01');
    expect(id).toMatch(/^cs_/);
    expect(upserts).toHaveLength(1);
    expect((upserts[0] as { url: string }).url).toBe('http://snomed.info/sct');
    expect((upserts[0] as { systemVersion: string }).systemVersion).toBe('2026-01');
  });

  it('reuses the existing coding system without upserting', async () => {
    const { admin, upserts } = fakeAdmin({ 'http://loinc.org': { id: 'cs_existing' } });
    const id = await resolveCodingSystemId(admin, 'loinc', null);
    expect(id).toBe('cs_existing');
    expect(upserts).toHaveLength(0);
  });

  it('throws on an unsupported system type', async () => {
    const { admin } = fakeAdmin({});
    await expect(resolveCodingSystemId(admin, 'icd10', null)).rejects.toThrow(/unsupported system type/);
  });
});
