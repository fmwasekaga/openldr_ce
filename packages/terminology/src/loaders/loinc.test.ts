import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, it, expect } from 'vitest';
import { loadLoinc, loincRowToConcept } from './loinc';
import type { LoaderStore, SavedRef } from './generic';

const tempDirs: string[] = [];

async function makeLoincDistributionRoot(csv: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openldr-loinc-'));
  tempDirs.push(root);
  const tableDir = join(root, 'LoincTable');
  await mkdir(tableDir, { recursive: true });
  await writeFile(join(tableDir, 'Loinc.csv'), csv);
  return root;
}

function memoryStore() {
  const concepts: unknown[][] = [];
  const systems: unknown[][] = [];
  const resources: unknown[] = [];
  const store: LoaderStore = {
    async upsertConcepts(rows) {
      concepts.push(rows);
    },
    async upsertMapElements() {},
    async saveResource(resource): Promise<SavedRef> {
      resources.push(resource);
      return { resourceType: 'CodeSystem', id: 'res-loinc' };
    },
    async saveSystem(...args) {
      systems.push(args);
    },
  };
  return { store, concepts, systems, resources };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('loincRowToConcept', () => {
  it('maps a LOINC CSV row to a concept', () => {
    const c = loincRowToConcept({
      LOINC_NUM: '2160-0',
      LONG_COMMON_NAME: 'Creatinine [Mass/volume] in Serum or Plasma',
      STATUS: 'ACTIVE',
      COMPONENT: 'Creatinine',
      PROPERTY: 'MCnc',
      SYSTEM: 'Ser/Plas',
      SCALE_TYP: 'Qn',
      METHOD_TYP: '',
      CLASS: 'CHEM',
    });
    expect(c.system).toBe('http://loinc.org');
    expect(c.code).toBe('2160-0');
    expect(c.display).toBe('Creatinine [Mass/volume] in Serum or Plasma');
    expect(c.status).toBe('ACTIVE');
    expect(c.properties).toMatchObject({ COMPONENT: 'Creatinine', CLASS: 'CHEM' });
  });

  it('imports from an extracted LOINC distribution root containing LoincTable/Loinc.csv', async () => {
    const root = await makeLoincDistributionRoot([
      'LOINC_NUM,LONG_COMMON_NAME,STATUS,COMPONENT,PROPERTY,SYSTEM,SCALE_TYP,METHOD_TYP,CLASS',
      '2160-0,Creatinine [Mass/volume] in Serum or Plasma,ACTIVE,Creatinine,MCnc,Ser/Plas,Qn,,CHEM',
    ].join('\n'));
    const s = memoryStore();

    const result = await loadLoinc(root, { acceptLicense: true }, s.store);

    expect(result).toMatchObject({ system: 'http://loinc.org', conceptsLoaded: 1 });
    expect(s.concepts.flat()).toMatchObject([
      { code: '2160-0', display: 'Creatinine [Mass/volume] in Serum or Plasma' },
    ]);
    expect(s.systems).toEqual([['http://loinc.org', null, 'CodeSystem', 'res-loinc']]);
  });
});
