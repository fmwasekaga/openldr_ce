import { z } from 'zod';
import { fhirId, fhirDateTime, fhirInstant } from '../datatypes/primitives';
import { Identifier, CodeableConcept, Reference, Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

export const DiagnosticReport = z
  .object({
    resourceType: z.literal('DiagnosticReport'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    basedOn: z.array(Reference).optional(),
    status: z.enum([
      'registered', 'partial', 'preliminary', 'final', 'amended', 'corrected', 'appended', 'cancelled', 'entered-in-error', 'unknown',
    ]),
    category: z.array(CodeableConcept).optional(),
    code: CodeableConcept,
    subject: Reference.optional(),
    effectiveDateTime: fhirDateTime.optional(),
    issued: fhirInstant.optional(),
    specimen: z.array(Reference).optional(),
    result: z.array(Reference).optional(),
    conclusion: z.string().optional(),
    conclusionCode: z.array(CodeableConcept).optional(),
  })
  .passthrough();
export type DiagnosticReport = z.infer<typeof DiagnosticReport>;

registerResource('DiagnosticReport', DiagnosticReport);
