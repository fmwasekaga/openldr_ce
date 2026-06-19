import type { FormField, FormSchema } from '../schema/form-schema'

/** Build a FormField with canonical defaults; caller supplies the identifying bits. */
export function makeField(
  overrides: Partial<FormField> &
    Pick<FormField, 'id' | 'displayLabel' | 'fieldType' | 'order'>,
): FormField {
  return {
    fhirPath: null,
    description: null,
    required: false,
    enabled: true,
    cardinality: { min: 0, max: '1' },
    ...overrides,
  }
}

/** Build a FormSchema with canonical defaults; caller supplies id + name. */
export function makeSchema(
  overrides: Partial<FormSchema> & Pick<FormSchema, 'id' | 'name'>,
): FormSchema {
  return {
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * The definition-bearing projection of a FormSchema — everything the adapters
 * are responsible for round-tripping. Excludes pure persistence/lifecycle
 * envelope fields (version, active, facilityId, timestamps).
 */
export function definitionOf(schema: FormSchema) {
  return {
    id: schema.id,
    name: schema.name,
    status: schema.status,
    versionLabel: schema.versionLabel,
    fhirVersion: schema.fhirVersion,
    fhirResourceType: schema.fhirResourceType,
    fhirProfileUrl: schema.fhirProfileUrl,
    sections: schema.sections,
    fields: schema.fields,
    languages: schema.languages,
  }
}
