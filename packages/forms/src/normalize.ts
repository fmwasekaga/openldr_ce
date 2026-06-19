import { FormSchema, type FormField, type FormSection } from './schema/form-schema';
import { deriveLanguagesFromTranslations } from './derive-languages';

type DraftObject = Record<string, unknown>;

export function normalizeFormSchema(input: unknown): FormSchema {
  const source = isObject(input) ? input : {};
  const name = stringValue(source.name) ?? stringValue(source.id) ?? 'Untitled form';
  const id = stringValue(source.id) ?? slug(name);

  // Normalize flat fields array
  const rawFields = Array.isArray(source.fields) ? source.fields : [];
  const fields = rawFields.map((f, idx) => normalizeField(f, idx));

  // Normalize flat sections array
  const sections = Array.isArray(source.sections) ? source.sections.map(normalizeSection) : [];

  // Derive targetPages default
  const targetPages = Array.isArray(source.targetPages) ? source.targetPages : [];

  // Derive languages from field translations if not explicitly set
  const explicitLanguages = Array.isArray(source.languages) && source.languages.length > 0
    ? (source.languages as string[])
    : undefined;
  const derivedLanguages = deriveLanguagesFromTranslations(fields as FormField[]);
  const languages = explicitLanguages ?? (derivedLanguages.length > 0 ? derivedLanguages : undefined);

  return FormSchema.parse({
    versionLabel: null,
    fhirVersion: null,
    fhirResourceType: null,
    fhirProfileUrl: null,
    facilityId: null,
    version: 1,
    active: true,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...source,
    id,
    name,
    fields,
    sections,
    targetPages,
    ...(languages !== undefined ? { languages } : {}),
  });
}

function normalizeSection(input: unknown): FormSection {
  const source = isObject(input) ? input : {};
  const id = stringValue(source.id) ?? 'section';
  const label = stringValue(source.label) ?? id;
  const order = typeof source.order === 'number' ? source.order : 0;

  return {
    ...source,
    id,
    label,
    order,
  } as FormSection;
}

function normalizeField(input: unknown, idx: number): FormField {
  const source = isObject(input) ? input : {};
  const id = stringValue(source.id) ?? `field-${idx}`;

  // Apply defaults for required fields not present
  const order = typeof source.order === 'number' ? source.order : idx;
  const enabled = typeof source.enabled === 'boolean' ? source.enabled : true;
  const cardinality = isObject(source.cardinality)
    ? source.cardinality
    : { min: 0, max: '1' };
  const required = typeof source.required === 'boolean' ? source.required : false;
  const fhirPath = source.fhirPath !== undefined ? source.fhirPath : null;
  const description = source.description !== undefined ? source.description : null;

  return {
    ...source,
    id,
    order,
    enabled,
    cardinality,
    required,
    fhirPath,
    description,
  } as FormField;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isObject(value: unknown): value is DraftObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'form';
}
