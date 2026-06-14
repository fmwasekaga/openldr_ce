export const EXT_OPENLDR_SPECIMEN_ORIGIN = 'https://openldr.org/fhir/StructureDefinition/specimen-origin';

export type SpecimenOrigin = 'inpatient' | 'outpatient' | 'unknown';

const VALID: ReadonlySet<string> = new Set(['inpatient', 'outpatient', 'unknown']);

/** Reads the CE specimen-origin extension (`valueCode`) from a Specimen resource; null if absent/invalid. */
export function readSpecimenOrigin(resource: unknown): SpecimenOrigin | null {
  const exts = (resource as { extension?: { url?: string; valueCode?: string }[] } | null)?.extension;
  if (!Array.isArray(exts)) return null;
  const hit = exts.find((e) => e?.url === EXT_OPENLDR_SPECIMEN_ORIGIN);
  const code = hit?.valueCode;
  return code && VALID.has(code) ? (code as SpecimenOrigin) : null;
}
