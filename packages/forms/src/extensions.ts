export const EXT_OPENLDR_FORM = 'https://openldr.org/fhir/StructureDefinition/form';
export const EXT_OPENLDR_SECTION = 'https://openldr.org/fhir/StructureDefinition/form-section';
export const EXT_OPENLDR_FIELD = 'https://openldr.org/fhir/StructureDefinition/form-field';

interface Ext {
  url: string;
  valueString?: string;
}

/** Read a valueString from an extension array by url. */
export function extString(extensions: unknown, url: string): string | undefined {
  if (!Array.isArray(extensions)) return undefined;
  const found = (extensions as Ext[]).find((e) => e?.url === url);
  return found?.valueString;
}
