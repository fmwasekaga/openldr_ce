import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse';
import type { ConceptRecord } from '@openldr/db';
import { OpenLdrError } from '@openldr/core';
import type { LoaderStore, LoadResult } from './generic';

const LOINC_SYSTEM = 'http://loinc.org';

export function loincRowToConcept(row: Record<string, string>): ConceptRecord {
  return {
    system: LOINC_SYSTEM,
    code: row.LOINC_NUM,
    display: row.LONG_COMMON_NAME || null,
    status: row.STATUS || null,
    properties: {
      COMPONENT: row.COMPONENT,
      PROPERTY: row.PROPERTY,
      SYSTEM: row.SYSTEM,
      SCALE_TYP: row.SCALE_TYP,
      METHOD_TYP: row.METHOD_TYP,
      CLASS: row.CLASS,
    },
  };
}

export async function loadLoinc(
  loincTableDir: string,
  opts: { acceptLicense: boolean },
  store: LoaderStore,
): Promise<LoadResult> {
  if (!opts.acceptLicense) {
    throw new OpenLdrError('LOINC import requires accepting the LOINC license (--accept-license)');
  }
  const file = join(loincTableDir, 'Loinc.csv');
  const parser = createReadStream(file).pipe(parse({ columns: true, skip_empty_lines: true }));
  let batch: ConceptRecord[] = [];
  let count = 0;
  for await (const row of parser as AsyncIterable<Record<string, string>>) {
    batch.push(loincRowToConcept(row));
    count++;
    if (batch.length >= 1000) {
      await store.upsertConcepts(batch);
      batch = [];
    }
  }
  if (batch.length) await store.upsertConcepts(batch);

  const cs = {
    resourceType: 'CodeSystem' as const,
    url: LOINC_SYSTEM,
    name: 'LOINC',
    status: 'active',
    content: 'not-present' as const,
  };
  const ref = await store.saveResource(cs);
  await store.saveSystem(LOINC_SYSTEM, null, 'CodeSystem', ref.id);
  return { system: LOINC_SYSTEM, conceptsLoaded: count, resourceUrl: LOINC_SYSTEM };
}
