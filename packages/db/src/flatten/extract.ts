import type { Provenance } from '../provenance';

type Json = Record<string, unknown>;

export function provColumns(p: Provenance): {
  source_system: string | null;
  plugin_id: string | null;
  plugin_version: string | null;
  batch_id: string | null;
} {
  return {
    source_system: p.sourceSystem ?? null,
    plugin_id: p.pluginId ?? null,
    plugin_version: p.pluginVersion ?? null,
    batch_id: p.batchId ?? null,
  };
}

export function firstIdentifier(r: Json): { system: string | null; value: string | null } {
  const id = (r['identifier'] as Json[] | undefined)?.[0];
  return { system: (id?.['system'] as string) ?? null, value: (id?.['value'] as string) ?? null };
}

export function codeable(concept: unknown): { code: string | null; text: string | null; system: string | null } {
  const c = concept as Json | undefined;
  const coding = (c?.['coding'] as Json[] | undefined)?.[0];
  return {
    code: (coding?.['code'] as string) ?? null,
    text: (c?.['text'] as string) ?? (coding?.['display'] as string) ?? null,
    system: (coding?.['system'] as string) ?? null,
  };
}

export function reference(ref: unknown): string | null {
  return ((ref as Json | undefined)?.['reference'] as string) ?? null;
}

// The bare id of a FHIR reference ("Patient/p1" -> "p1"); null if absent. Used for soft (unenforced)
// foreign keys in the v2 read-model.
export function referenceId(ref: unknown): string | null {
  const r = reference(ref);
  return r ? r.replace(/^[^/]+\//, '') : null;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}
