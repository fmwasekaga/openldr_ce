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
  const marks: string[] = [];
  const store: LoaderStore = {
    async upsertConcepts(rows) {
      concepts.push(rows);
    },
    async upsertMapElements() {},
    async markSystemChanged(url) {
      marks.push(url);
    },
    async saveResource(resource): Promise<SavedRef> {
      resources.push(resource);
      return { resourceType: 'CodeSystem', id: 'res-loinc' };
    },
    async saveSystem(...args) {
      systems.push(args);
    },
  };
  return { store, concepts, systems, resources, marks };
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
    // Sync S3: exactly one bulk-change signal for the whole import.
    expect(s.marks).toEqual(['http://loinc.org']);
  });

  it('signals the system exactly ONCE even when concepts span multiple upsert batches', async () => {
    // >1000 rows forces loadLoinc to flush multiple upsertConcepts batches; the mark must still fire once.
    const header = 'LOINC_NUM,LONG_COMMON_NAME,STATUS,COMPONENT,PROPERTY,SYSTEM,SCALE_TYP,METHOD_TYP,CLASS';
    const lines = [header];
    for (let i = 0; i < 2500; i++) lines.push(`${i}-0,Concept ${i},ACTIVE,C,MCnc,Ser,Qn,,CHEM`);
    const root = await makeLoincDistributionRoot(lines.join('\n'));
    const s = memoryStore();

    const result = await loadLoinc(root, { acceptLicense: true }, s.store);

    expect(result.conceptsLoaded).toBe(2500);
    expect(s.concepts.length).toBeGreaterThan(1); // proves >1 batch flushed
    expect(s.marks).toEqual(['http://loinc.org']); // one signal, not one-per-batch
  });
});
