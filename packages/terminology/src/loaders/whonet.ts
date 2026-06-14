import { DatabaseSync } from 'node:sqlite';
import type { ConceptRecord } from '@openldr/db';
import { OpenLdrError } from '@openldr/core';
import type { LoaderStore, LoadResult } from './generic';

export const ANTIBIOTIC_SYSTEM = 'http://whonet.org/fhir/CodeSystem/antibiotic';
export const ORGANISM_SYSTEM = 'http://whonet.org/fhir/CodeSystem/organism';
export const ANTIBIOTIC_VS = 'http://whonet.org/fhir/ValueSet/antibiotics';
export const ORGANISM_VS = 'http://whonet.org/fhir/ValueSet/organisms';

interface Fwd { WHONET_Code: string; ASIARS_Net_Code: number }
interface Rev { ASIARS_Net_Code: number; WHONET_Code: string }

export function joinForwardReverse(forward: Fwd[], reverse: Rev[]): { code: string; display: string }[] {
  const nameByNum = new Map(reverse.map((r) => [r.ASIARS_Net_Code, r.WHONET_Code]));
  return forward
    .filter((f) => f.WHONET_Code && nameByNum.has(f.ASIARS_Net_Code))
    .map((f) => ({ code: f.WHONET_Code, display: nameByNum.get(f.ASIARS_Net_Code)! }));
}

function readPair(db: DatabaseSync, fwdTable: string, revTable: string): { code: string; display: string }[] {
  const forward = db.prepare(`SELECT WHONET_Code, ASIARS_Net_Code FROM "${fwdTable}"`).all() as unknown as Fwd[];
  const reverse = db.prepare(`SELECT ASIARS_Net_Code, WHONET_Code FROM "${revTable}"`).all() as unknown as Rev[];
  return joinForwardReverse(forward, reverse);
}

export async function loadWhonetAmr(sqlitePath: string, store: LoaderStore): Promise<LoadResult[]> {
  let db: DatabaseSync;
  try { db = new DatabaseSync(sqlitePath, { readOnly: true }); } catch (e) { throw new OpenLdrError(`cannot open WHONET sqlite: ${(e as Error).message}`); }
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
  for (const t of ['Antibiotics_ForwardLookup', 'Antibiotics_ReverseLookup', 'Organisms_ForwardLookup', 'Organisms_ReverseLookup']) {
    if (!tables.has(t)) { db.close(); throw new OpenLdrError(`WHONET sqlite missing expected table ${t}`); }
  }

  const results: LoadResult[] = [];
  for (const [system, vsUrl, name, fwd, rev] of [
    [ANTIBIOTIC_SYSTEM, ANTIBIOTIC_VS, 'WHONET Antibiotics', 'Antibiotics_ForwardLookup', 'Antibiotics_ReverseLookup'],
    [ORGANISM_SYSTEM, ORGANISM_VS, 'WHONET Organisms', 'Organisms_ForwardLookup', 'Organisms_ReverseLookup'],
  ] as const) {
    const pairs = readPair(db, fwd, rev);
    const rows: ConceptRecord[] = pairs.map((p) => ({ system, code: p.code, display: p.display, status: null, properties: null }));
    await store.upsertConcepts(rows);
    const csRef = await store.saveResource({ resourceType: 'CodeSystem', url: system, name, status: 'active', content: 'complete', concept: pairs.map((p) => ({ code: p.code, display: p.display })) });
    await store.saveSystem(system, null, 'CodeSystem', csRef.id);
    const vsRef = await store.saveResource({ resourceType: 'ValueSet', url: vsUrl, name: `${name} (all)`, status: 'active', compose: { include: [{ system }] } });
    await store.saveSystem(vsUrl, null, 'ValueSet', vsRef.id);
    results.push({ system, conceptsLoaded: rows.length, resourceUrl: system });
  }
  db.close();
  return results;
}
