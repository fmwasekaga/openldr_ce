import { z } from 'zod';
import { fhirId, fhirDateTime } from '../datatypes/primitives';
import { Identifier, CodeableConcept, Reference, Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

export const ServiceRequest = z
  .object({
    resourceType: z.literal('ServiceRequest'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    status: z.enum(['draft', 'active', 'on-hold', 'revoked', 'completed', 'entered-in-error', 'unknown']),
    intent: z.enum(['proposal', 'plan', 'directive', 'order', 'original-order', 'reflex-order', 'filler-order', 'instance-order', 'option']),
    category: z.array(CodeableConcept).optional(),
    priority: z.enum(['routine', 'urgent', 'asap', 'stat']).optional(),
    code: CodeableConcept.optional(),
    subject: Reference,
    encounter: Reference.optional(),
    authoredOn: fhirDateTime.optional(),
    requester: Reference.optional(),
    specimen: z.array(Reference).optional(),
  })
  .passthrough();
export type ServiceRequest = z.infer<typeof ServiceRequest>;

registerResource('ServiceRequest', ServiceRequest);
