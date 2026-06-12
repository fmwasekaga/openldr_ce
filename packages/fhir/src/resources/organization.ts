import { z } from 'zod';
import { fhirId, fhirBoolean } from '../datatypes/primitives';
import { Identifier, CodeableConcept, ContactPoint, Address, Meta, Reference } from '../datatypes/complex';
import { registerResource } from '../registry';

export const Organization = z
  .object({
    resourceType: z.literal('Organization'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    active: fhirBoolean.optional(),
    type: z.array(CodeableConcept).optional(),
    name: z.string().optional(),
    telecom: z.array(ContactPoint).optional(),
    address: z.array(Address).optional(),
    partOf: Reference.optional(),
  })
  .passthrough();
export type Organization = z.infer<typeof Organization>;

registerResource('Organization', Organization);
