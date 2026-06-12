import { z } from 'zod';

export const TranslatableText = z.object({
  en: z.string(),
  fr: z.string().optional(),
  pt: z.string().optional(),
});
export type TranslatableText = z.infer<typeof TranslatableText>;

export const FieldOption = z.object({
  code: z.string(),
  display: TranslatableText,
  system: z.string().optional(),
});

export const VisibilityRule = z.object({
  whenField: z.string(),
  equals: z.union([z.string(), z.number(), z.boolean()]),
});

export const FieldType = z.enum([
  'string', 'text', 'integer', 'decimal', 'boolean',
  'date', 'dateTime', 'choice', 'open-choice', 'reference', 'quantity',
]);
export type FieldType = z.infer<typeof FieldType>;

const FieldCode = z.object({ system: z.string().optional(), code: z.string(), display: z.string().optional() });
const Cardinality = z.object({
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().positive().optional(),
});

export const FormField = z
  .object({
    id: z.string(),
    type: FieldType,
    label: TranslatableText,
    required: z.boolean().optional(),
    repeats: z.boolean().optional(),
    cardinality: Cardinality.optional(),
    options: z.array(FieldOption).optional(),
    visibility: VisibilityRule.optional(),
    fhirPath: z.string().optional(),
    observationExtract: z.boolean().optional(),
    code: FieldCode.optional(),
    unit: z.string().optional(),
  })
  .superRefine((f, ctx) => {
    if ((f.type === 'choice' || f.type === 'open-choice') && !f.options) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'choice field requires options', path: ['options'] });
    }
    if (f.observationExtract && !f.code) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'observationExtract field requires code', path: ['code'] });
    }
  });
export type FormField = z.infer<typeof FormField>;

export const ResourceType = z.enum([
  'Patient', 'ServiceRequest', 'Specimen', 'Organization', 'Location', 'DiagnosticReport',
]);

export const FormSection = z.object({
  id: z.string(),
  title: TranslatableText,
  resourceType: ResourceType.optional(),
  repeats: z.boolean().optional(),
  fields: z.array(FormField),
});
export type FormSection = z.infer<typeof FormSection>;

export const FormSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    title: TranslatableText,
    status: z.enum(['draft', 'active', 'retired']),
    languages: z.array(z.enum(['en', 'fr', 'pt'])),
    sections: z.array(FormSection),
  })
  .superRefine((form, ctx) => {
    const seen = new Set<string>();
    for (const section of form.sections) {
      if (seen.has(section.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate id: ${section.id}` });
      seen.add(section.id);
      for (const field of section.fields) {
        if (seen.has(field.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate id: ${field.id}` });
        seen.add(field.id);
      }
    }
  });
export type FormSchema = z.infer<typeof FormSchema>;
