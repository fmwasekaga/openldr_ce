import type { FormField, FormSchema, FormSection } from './schema/form-schema';

export type MetadataChange = { kind: 'changed'; path: string; before: unknown; after: unknown };
export type SectionChange =
  | { kind: 'added'; sectionId: string; after: FormSection }
  | { kind: 'removed'; sectionId: string; before: FormSection }
  | { kind: 'changed'; sectionId: string; path: string; before: unknown; after: unknown };
export type FieldChange =
  | { kind: 'added'; fieldId: string; after: FormField }
  | { kind: 'removed'; fieldId: string; before: FormField }
  | { kind: 'changed'; fieldId: string; path: string; before: unknown; after: unknown };

export interface FormSchemaDiff {
  metadata: MetadataChange[];
  sections: SectionChange[];
  fields: FieldChange[];
}

const METADATA_KEYS = ['id', 'name', 'status', 'fhirResourceType', 'fhirProfileUrl', 'fhirVersion', 'languages', 'targetPages', 'versionLabel'] as const;
const SECTION_KEYS = ['label', 'order', 'fhirResourceType', 'visibility'] as const;
const FIELD_KEYS = [
  'displayLabel', 'fieldType', 'required', 'enabled', 'order', 'section', 'groupId',
  'cardinality', 'valueSetOptions', 'valueSetUrl', 'bindingStrength',
  'visibility', 'fhirPath', 'observationExtract', 'code', 'unit',
  'placeholder', 'adminNote', 'apiProperty', 'translations',
  'repeatable', 'minItems', 'maxItems', 'description',
] as const;

export function diffFormSchemas(before: FormSchema, after: FormSchema): FormSchemaDiff {
  return {
    metadata: changedProperties(before, after, METADATA_KEYS).map(({ path, before: b, after: a }) => ({
      kind: 'changed' as const,
      path,
      before: b,
      after: a,
    })),
    sections: diffSections(before.sections, after.sections),
    fields: diffFields(before.fields, after.fields),
  };
}

function diffSections(before: FormSection[], after: FormSection[]): SectionChange[] {
  const changes: SectionChange[] = [];
  const beforeById = byId(before);
  const afterById = byId(after);

  for (const section of before) {
    const next = afterById.get(section.id);
    if (!next) {
      changes.push({ kind: 'removed', sectionId: section.id, before: section });
      continue;
    }
    for (const change of changedProperties(section, next, SECTION_KEYS)) {
      changes.push({ kind: 'changed', sectionId: section.id, path: change.path, before: change.before, after: change.after });
    }
  }

  for (const section of after) {
    if (!beforeById.has(section.id)) {
      changes.push({ kind: 'added', sectionId: section.id, after: section });
    }
  }

  return changes;
}

function diffFields(before: FormField[], after: FormField[]): FieldChange[] {
  const changes: FieldChange[] = [];
  const beforeById = byId(before);
  const afterById = byId(after);

  for (const field of before) {
    const next = afterById.get(field.id);
    if (!next) {
      changes.push({ kind: 'removed', fieldId: field.id, before: field });
      continue;
    }
    for (const change of changedProperties(field, next, FIELD_KEYS)) {
      changes.push({ kind: 'changed', fieldId: field.id, path: change.path, before: change.before, after: change.after });
    }
  }

  for (const field of after) {
    if (!beforeById.has(field.id)) {
      changes.push({ kind: 'added', fieldId: field.id, after: field });
    }
  }

  return changes;
}

function changedProperties<T extends Record<string, unknown>>(
  before: T,
  after: T,
  keys: readonly string[],
): Array<{ path: string; before: unknown; after: unknown }> {
  return keys.flatMap((key) => {
    const beforeValue = before[key];
    const afterValue = after[key];
    return stableStringify(beforeValue) === stableStringify(afterValue)
      ? []
      : [{ path: key, before: beforeValue, after: afterValue }];
  });
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}
