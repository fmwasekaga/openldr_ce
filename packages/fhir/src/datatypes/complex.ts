import { z } from 'zod';
import { fhirUri, fhirCode, fhirString, fhirBoolean, fhirDecimal, fhirDateTime, fhirInstant } from './primitives';

export const Coding = z
  .object({
    system: fhirUri.optional(),
    version: z.string().optional(),
    code: fhirCode.optional(),
    display: z.string().optional(),
    userSelected: fhirBoolean.optional(),
  })
  .passthrough();
export type Coding = z.infer<typeof Coding>;

export const CodeableConcept = z
  .object({
    coding: z.array(Coding).optional(),
    text: z.string().optional(),
  })
  .passthrough();
export type CodeableConcept = z.infer<typeof CodeableConcept>;

export const Period = z
  .object({
    start: fhirDateTime.optional(),
    end: fhirDateTime.optional(),
  })
  .passthrough();
export type Period = z.infer<typeof Period>;

export const Identifier = z
  .object({
    use: z.enum(['usual', 'official', 'temp', 'secondary', 'old']).optional(),
    type: CodeableConcept.optional(),
    system: fhirUri.optional(),
    value: z.string().optional(),
    period: Period.optional(),
  })
  .passthrough();
export type Identifier = z.infer<typeof Identifier>;

export const Reference = z
  .object({
    reference: z.string().optional(),
    type: fhirUri.optional(),
    display: z.string().optional(),
  })
  .passthrough();
export type Reference = z.infer<typeof Reference>;

export const HumanName = z
  .object({
    use: z.enum(['usual', 'official', 'temp', 'nickname', 'anonymous', 'old', 'maiden']).optional(),
    text: z.string().optional(),
    family: z.string().optional(),
    given: z.array(z.string()).optional(),
    prefix: z.array(z.string()).optional(),
    suffix: z.array(z.string()).optional(),
    period: Period.optional(),
  })
  .passthrough();
export type HumanName = z.infer<typeof HumanName>;

export const ContactPoint = z
  .object({
    system: z.enum(['phone', 'fax', 'email', 'pager', 'url', 'sms', 'other']).optional(),
    value: z.string().optional(),
    use: z.enum(['home', 'work', 'temp', 'old', 'mobile']).optional(),
    rank: z.number().int().positive().optional(),
    period: Period.optional(),
  })
  .passthrough();
export type ContactPoint = z.infer<typeof ContactPoint>;

export const Address = z
  .object({
    use: z.enum(['home', 'work', 'temp', 'old', 'billing']).optional(),
    type: z.enum(['postal', 'physical', 'both']).optional(),
    text: z.string().optional(),
    line: z.array(z.string()).optional(),
    city: z.string().optional(),
    district: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().optional(),
    period: Period.optional(),
  })
  .passthrough();
export type Address = z.infer<typeof Address>;

export const Quantity = z
  .object({
    value: fhirDecimal.optional(),
    comparator: z.enum(['<', '<=', '>=', '>']).optional(),
    unit: z.string().optional(),
    system: fhirUri.optional(),
    code: fhirCode.optional(),
  })
  .passthrough();
export type Quantity = z.infer<typeof Quantity>;

export const Meta = z
  .object({
    versionId: z.string().optional(),
    lastUpdated: fhirInstant.optional(),
    source: fhirUri.optional(),
    profile: z.array(fhirUri).optional(),
    security: z.array(Coding).optional(),
    tag: z.array(Coding).optional(),
  })
  .passthrough();
export type Meta = z.infer<typeof Meta>;

export const Annotation = z
  .object({
    authorString: z.string().optional(),
    authorReference: Reference.optional(),
    time: fhirDateTime.optional(),
    text: fhirString,
  })
  .passthrough();
export type Annotation = z.infer<typeof Annotation>;
