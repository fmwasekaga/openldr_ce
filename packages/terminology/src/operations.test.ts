import { describe, it, expect } from 'vitest';
import { createOperations } from './operations';
import type { ConceptSource } from './source';
import type { ConceptRecord } from '@openldr/db';

function memSource(concepts: ConceptRecord[], resources: Record<string, unknown> = {}): ConceptSource {
  const has = (system: string, code: string) => concepts.find((c) => c.system === system && c.code === code) ?? null;
  return {
    async getConcept(s, c) { return has(s, c); },
    async findConcepts(q) {
      let rows = concepts.filter((c) => c.system === q.system);
      if (q.codes) rows = rows.filter((c) => q.codes!.includes(c.code));
      if (q.property) rows = rows.filter((c) => (c.properties as Record<string, unknown> | null)?.[q.property!.name] === q.property!.value);
      return rows.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100));
    },
    async countConcepts(q) {
      let rows = concepts.filter((c) => c.system === q.system);
      if (q.codes) rows = rows.filter((c) => q.codes!.includes(c.code));
      return rows.length;
    },
    async getResourceByUrl(url) { return resources[url] ?? null; },
    async translate() { return []; },
  };
}

const loinc: ConceptRecord[] = [{ system: 'http://loinc.org', code: '2160-0', display: 'Creatinine', status: 'ACTIVE', properties: { CLASS: 'CHEM' } }];

describe('lookup', () => {
  const ops = createOperations(memSource(loinc));
  it('finds a concept', async () => {
    const r = await ops.lookup('http://loinc.org', '2160-0');
    expect(r.found).toBe(true);
    expect(r.display).toBe('Creatinine');
  });
  it('misses unknown', async () => {
    expect((await ops.lookup('http://loinc.org', 'nope')).found).toBe(false);
  });
});

describe('validateCode (CodeSystem)', () => {
  const ops = createOperations(memSource(loinc));
  it('true for an existing code', async () => {
    expect((await ops.validateCode({ system: 'http://loinc.org', code: '2160-0' })).result).toBe(true);
  });
  it('false for a missing code', async () => {
    expect((await ops.validateCode({ system: 'http://loinc.org', code: 'x' })).result).toBe(false);
  });
});
