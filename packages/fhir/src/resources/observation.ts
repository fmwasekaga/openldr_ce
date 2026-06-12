import { z } from 'zod';
import { fhirId, fhirDateTime, fhirInstant, fhirString } from '../datatypes/primitives';
import { Identifier, CodeableConcept, Reference, Quantity, Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

const ObservationComponent = z
  .object({
    code: CodeableConcept,
    valueQuantity: Quantity.optional(),
    valueCodeableConcept: CodeableConcept.optional(),
    valueString: fhirString.optional(),
    interpretation: z.array(CodeableConcept).optional(),
  })
  .passthrough();

export const Observation = z
  .object({
    resourceType: z.literal('Observation'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    basedOn: z.array(Reference).optional(),
    status: z.enum(['registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown']),
    category: z.array(CodeableConcept).optional(),
    code: CodeableConcept,
    subject: Reference.optional(),
    effectiveDateTime: fhirDateTime.optional(),
    issued: fhirInstant.optional(),
    valueQuantity: Quantity.optional(),
    valueCodeableConcept: CodeableConcept.optional(),
    valueString: fhirString.optional(),
    interpretation: z.array(CodeableConcept).optional(),
    method: CodeableConcept.optional(),
    specimen: Reference.optional(),
    component: z.array(ObservationComponent).optional(),
  })
  .passthrough();
export type Observation = z.infer<typeof Observation>;

registerResource('Observation', Observation);
