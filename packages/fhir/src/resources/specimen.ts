import { z } from 'zod';
import { fhirId, fhirDateTime } from '../datatypes/primitives';
import { Identifier, CodeableConcept, Reference, Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

export const Specimen = z
  .object({
    resourceType: z.literal('Specimen'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    accessionIdentifier: Identifier.optional(),
    status: z.enum(['available', 'unavailable', 'unsatisfactory', 'entered-in-error']).optional(),
    type: CodeableConcept.optional(),
    subject: Reference.optional(),
    receivedTime: fhirDateTime.optional(),
    parent: z.array(Reference).optional(),
    request: z.array(Reference).optional(),
    collection: z
      .object({
        collectedDateTime: fhirDateTime.optional(),
        bodySite: CodeableConcept.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type Specimen = z.infer<typeof Specimen>;

registerResource('Specimen', Specimen);
