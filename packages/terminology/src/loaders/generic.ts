import { validateResource } from '@openldr/fhir';
import { OpenLdrError } from '@openldr/core';
import type { ConceptRecord, MapElement } from '@openldr/db';

export interface SavedRef { resourceType: string; id: string }

export interface LoaderStore {
  upsertConcepts(rows: ConceptRecord[]): Promise<void>;
  upsertMapElements(rows: MapElement[]): Promise<void>;
  saveResource(resource: unknown): Promise<SavedRef>;
  saveSystem(url: string, version: string | null, kind: string, resourceId: string): Promise<void>;
}

export interface LoadResult { system: string; conceptsLoaded: number; resourceUrl: string }

export async function importTerminologyResource(json: unknown, store: LoaderStore): Promise<LoadResult> {
  const v = validateResource(json);
  if (!v.ok) throw new OpenLdrError('invalid terminology resource');
  const res = v.resource as {
    resourceType: string;
    url?: string;
    concept?: { code: string; display?: string }[];
    group?: { source?: string; target?: string; element: { code: string; target?: { code: string; equivalence?: string }[] }[] }[];
  };
  if (!res.url) throw new OpenLdrError('terminology resource requires a url');
  const ref = await store.saveResource(res);
  await store.saveSystem(res.url, null, res.resourceType, ref.id);
  let conceptsLoaded = 0;
  if (res.resourceType === 'CodeSystem' && res.concept) {
    const rows: ConceptRecord[] = res.concept.map((c) => ({
      system: res.url!,
      code: c.code,
      display: c.display ?? null,
      status: null,
      properties: null,
    }));
    await store.upsertConcepts(rows);
    conceptsLoaded = rows.length;
  }
  if (res.resourceType === 'ConceptMap' && res.group) {
    const els: MapElement[] = [];
    for (const g of res.group) {
      for (const e of g.element) {
        for (const t of e.target ?? []) {
          els.push({
            mapUrl: res.url!,
            sourceSystem: g.source ?? '',
            sourceCode: e.code,
            targetSystem: g.target ?? '',
            targetCode: t.code,
            equivalence: t.equivalence ?? null,
          });
        }
      }
    }
    await store.upsertMapElements(els);
  }
  return { system: res.url, conceptsLoaded, resourceUrl: res.url };
}
