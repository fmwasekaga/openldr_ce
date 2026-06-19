import { z } from 'zod';

export const FieldType = z.enum([
  'text', 'number', 'date', 'datetime', 'boolean',
  'select', 'multiselect', 'phone', 'email', 'address',
  'identifier', 'attachment', 'organism', 'antibiogram',
  'reference', 'facility', 'group',
]);
export type FieldType = z.infer<typeof FieldType>;

export const FormFieldConstraints = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().optional(),
  decimalPlaces: z.number().optional(),
});
export type FormFieldConstraints = z.infer<typeof FormFieldConstraints>;

export const FormFieldOption = z.object({
  code: z.string(),
  display: z.string(),
  translations: z.record(z.string()).optional(),
});
export type FormFieldOption = z.infer<typeof FormFieldOption>;

export const FormFieldCoding = z.object({
  system: z.string(),
  code: z.string(),
  display: z.string().optional(),
});
export type FormFieldCoding = z.infer<typeof FormFieldCoding>;

export const VisibilityOperator = z.enum([
  'equals', 'notEquals', 'oneOf', 'isEmpty', 'isNotEmpty', 'gt', 'lt', 'gte', 'lte',
]);
export type VisibilityOperator = z.infer<typeof VisibilityOperator>;

export const VisibilityCondition = z.object({
  fieldId: z.string(),
  operator: VisibilityOperator,
  value: z.string().optional(),
});
export type VisibilityCondition = z.infer<typeof VisibilityCondition>;

export const VisibilityRule = z.object({
  combinator: z.enum(['all', 'any']),
  conditions: z.array(VisibilityCondition),
});
export type VisibilityRule = z.infer<typeof VisibilityRule>;

export const BindingStrength = z.enum(['required', 'extensible', 'preferred', 'example']);
export type BindingStrength = z.infer<typeof BindingStrength>;

export const FormField = z.object({
  id: z.string(),
  fhirPath: z.string().nullable(),
  displayLabel: z.string(),
  description: z.string().nullable(),
  fieldType: FieldType,
  required: z.boolean(),
  enabled: z.boolean(),
  order: z.number(),
  cardinality: z.object({ min: z.number(), max: z.string() }),
  valueSetUrl: z.string().optional(),
  bindingStrength: BindingStrength.optional(),
  valueSetOptions: z.array(FormFieldOption).optional(),
  code: z.array(FormFieldCoding).optional(),
  observationExtract: z.boolean().optional(),
  constraints: FormFieldConstraints.optional(),
  adminNote: z.string().optional(),
  placeholder: z.string().optional(),
  section: z.string().optional(),
  unit: z.string().optional(),
  apiProperty: z.string().optional(),
  fhirDiscriminator: z.record(z.string()).optional(),
  fhirValueField: z.string().optional(),
  isDisplayName: z.boolean().optional(),
  displayNameOrder: z.number().optional(),
  allowCustomValue: z.boolean().optional(),
  referenceTarget: z.string().optional(),
  referenceDisplayField: z.string().optional(),
  referenceValueField: z.string().optional(),
  referenceMultiple: z.boolean().optional(),
  referenceDependsOn: z.string().optional(),
  referenceSearchable: z.boolean().optional(),
  translations: z.record(z.object({
    label: z.string().optional(),
    description: z.string().optional(),
  })).optional(),
  repeatable: z.boolean().optional(),
  minItems: z.number().optional(),
  maxItems: z.number().optional(),
  groupId: z.string().optional(),
  visibility: VisibilityRule.optional(),
  locked: z.boolean().optional(),
});
export type FormField = z.infer<typeof FormField>;

export const FormSection = z.object({
  id: z.string(),
  label: z.string(),
  order: z.number(),
  fhirResourceType: z.string().optional(),
  visibility: VisibilityRule.optional(),
});
export type FormSection = z.infer<typeof FormSection>;

export const FormStatus = z.enum(['draft', 'published', 'archived']);
export type FormStatus = z.infer<typeof FormStatus>;

export const FormSchema = z.object({
  id: z.string(),
  name: z.string(),
  versionLabel: z.string().nullable(),
  fhirVersion: z.string().nullable(),
  fhirResourceType: z.string().nullable(),
  fhirProfileUrl: z.string().nullable(),
  facilityId: z.string().nullable(),
  fields: z.array(FormField),
  sections: z.array(FormSection),
  targetPages: z.array(z.string()),
  languages: z.array(z.string()).optional(),
  version: z.number(),
  active: z.boolean(),
  status: FormStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FormSchema = z.infer<typeof FormSchema>;
