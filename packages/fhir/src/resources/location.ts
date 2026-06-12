import { z } from 'zod';
import { fhirId } from '../datatypes/primitives';
import { Identifier, CodeableConcept, ContactPoint, Address, Meta, Reference } from '../datatypes/complex';
import { registerResource } from '../registry';

export const Location = z
  .object({
    resourceType: z.literal('Location'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    status: z.enum(['active', 'suspended', 'inactive']).optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    mode: z.enum(['instance', 'kind']).optional(),
    type: z.array(CodeableConcept).optional(),
    telecom: z.array(ContactPoint).optional(),
    address: Address.optional(),
    physicalType: CodeableConcept.optional(),
    managingOrganization: Reference.optional(),
    partOf: Reference.optional(),
  })
  .passthrough();
export type Location = z.infer<typeof Location>;

registerResource('Location', Location);
