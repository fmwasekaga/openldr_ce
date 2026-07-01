import type { FieldType, FormField, FormSchema } from '@openldr/forms/pure';

export function slugify(label: string): string {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return s || 'item';
}

/** Return `base` if unused, else `base-2`, `base-3`, … until unique among `existing`. */
export function makeUniqueFieldId(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

let _orderCounter = 0;

export function createDefaultFormSchema(name: string): FormSchema {
  const now = new Date().toISOString();
  return {
    id: slugify(name),
    name,
    versionLabel: null,
    fhirVersion: null,
    fhirResourceType: null,
    fhirProfileUrl: null,
    facilityId: null,
    fields: [],
    sections: [],
    targetPages: [],
    version: 1,
    active: true,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
}

export function newField(displayLabel: string, fieldType: FieldType): FormField {
  return {
    id: slugify(displayLabel),
    fhirPath: null,
    displayLabel,
    description: null,
    fieldType,
    required: false,
    enabled: true,
    order: _orderCounter++,
    cardinality: { min: 0, max: '1' },
  };
}
