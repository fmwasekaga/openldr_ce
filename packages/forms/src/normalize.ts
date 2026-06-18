import { FormSchema, type FormField, type FormSection } from './schema/form-schema';

type DraftObject = Record<string, unknown>;

export function normalizeFormSchema(input: unknown): FormSchema {
  const source = isObject(input) ? input : {};
  const name = stringValue(source.name) ?? stringValue(source.id) ?? 'Untitled form';
  const id = stringValue(source.id) ?? slug(name);
  const sections = Array.isArray(source.sections) ? source.sections.map(normalizeSection) : [];

  return FormSchema.parse({
    ...source,
    id,
    name,
    title: normalizeText(source.title, name),
    status: source.status ?? 'draft',
    languages: normalizeLanguages(source.languages),
    sections,
  });
}

function normalizeSection(input: unknown): FormSection {
  const source = isObject(input) ? input : {};
  const id = stringValue(source.id) ?? 'section';
  const fields = Array.isArray(source.fields) ? source.fields.map(normalizeField) : [];

  return {
    ...source,
    id,
    title: normalizeText(source.title, id),
    fields,
  } as FormSection;
}

function normalizeField(input: unknown): FormField {
  const source = isObject(input) ? input : {};
  const id = stringValue(source.id) ?? 'field';

  return {
    ...source,
    id,
    type: source.type ?? 'string',
    label: normalizeText(source.label, id),
  } as FormField;
}

function normalizeLanguages(value: unknown): string[] {
  return Array.isArray(value) && value.length > 0 ? value : ['en'];
}

function normalizeText(value: unknown, fallback: string): { en: string; fr?: string; pt?: string } {
  if (typeof value === 'string') return { en: value };
  if (isObject(value)) return { ...value, en: stringValue(value.en) ?? fallback } as { en: string; fr?: string; pt?: string };
  return { en: fallback };
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
