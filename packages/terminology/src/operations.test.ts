import { describe, it, expect } from 'vitest';
import { createOperations } from './operations';
import type { ConceptSource } from './source';
import type { ConceptRecord } from '@openldr/db';
import type { ValueSet } from '@openldr/fhir';

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

const abx: ConceptRecord[] = [
  { system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'AMP', display: 'Ampicillin', status: null, properties: null },
  { system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'CIP', display: 'Ciprofloxacin', status: null, properties: null },
  { system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'GEN', display: 'Gentamicin', status: null, properties: null },
];
const abxVs: ValueSet = { resourceType: 'ValueSet', url: 'http://whonet.org/fhir/ValueSet/antibiotics', status: 'active', compose: { include: [{ system: 'http://whonet.org/fhir/CodeSystem/antibiotic' }] } };

describe('expand', () => {
  const ops = createOperations(memSource(abx, { [abxVs.url]: abxVs }));
  it('expands a whole-system include, paginated', async () => {
    const vs = await ops.expand('http://whonet.org/fhir/ValueSet/antibiotics', { count: 2, offset: 0 });
    expect(vs.expansion?.total).toBe(3);
    expect(vs.expansion?.contains?.map((c) => c.code)).toEqual(['AMP', 'CIP']);
  });
  it('expands a multi-include ValueSet with an exclude', async () => {
    const source = memSource([
      { system: 's1', code: 'A', display: 'Alpha', status: 'ACTIVE', properties: null },
      { system: 's1', code: 'B', display: 'Beta', status: 'ACTIVE', properties: null },
      { system: 's2', code: 'Z', display: 'Zeta', status: 'ACTIVE', properties: null },
    ], {
      'urn:vs:multi': {
        resourceType: 'ValueSet', url: 'urn:vs:multi', status: 'active',
        compose: { include: [{ system: 's1' }, { system: 's2' }], exclude: [{ system: 's1', concept: [{ code: 'B' }] }] },
      },
    });
    const multiOps = createOperations(source);
    const vs = await multiOps.expand('urn:vs:multi', {});
    expect(vs.expansion?.contains?.map((c) => c.code)).toEqual(['A', 'Z']);
  });
  it('404s an unknown ValueSet', async () => {
    await expect(ops.expand('http://x/nope', {})).rejects.toThrow(/not found/i);
  });
});

describe('validateCode (ValueSet)', () => {
  const ops = createOperations(memSource(abx, { [abxVs.url]: abxVs }));
  it('true when the code is in the ValueSet', async () => {
    expect((await ops.validateCode({ valueSetUrl: abxVs.url, code: 'AMP' })).result).toBe(true);
  });
  it('false when not', async () => {
    expect((await ops.validateCode({ valueSetUrl: abxVs.url, code: 'XXX' })).result).toBe(false);
  });
});

describe('translate', () => {
  const src = memSource(abx);
  // override translate for this test
  src.translate = async (q) => (q.code === 'AMP' ? [{ mapUrl: 'http://x/cm', sourceSystem: q.system, sourceCode: 'AMP', targetSystem: 'http://loinc.org', targetCode: '101477-8', equivalence: 'equivalent' }] : []);
  const ops = createOperations(src);
  it('returns mapped targets', async () => {
    const r = await ops.translate({ system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'AMP' });
    expect(r.result).toBe(true);
    expect(r.matches[0].targetCode).toBe('101477-8');
  });
  it('empty for unmapped', async () => {
    const r = await ops.translate({ system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'CIP' });
    expect(r.result).toBe(false);
    expect(r.matches).toEqual([]);
  });
});
