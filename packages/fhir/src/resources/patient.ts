import { z } from 'zod';
import { fhirId, fhirBoolean, fhirDate, fhirDateTime } from '../datatypes/primitives';
import { Identifier, HumanName, ContactPoint, Address, Meta, Reference } from '../datatypes/complex';
import { registerResource } from '../registry';

export const Patient = z
  .object({
    resourceType: z.literal('Patient'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    identifier: z.array(Identifier).optional(),
    active: fhirBoolean.optional(),
    name: z.array(HumanName).optional(),
    telecom: z.array(ContactPoint).optional(),
    gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
    birthDate: fhirDate.optional(),
    deceasedBoolean: fhirBoolean.optional(),
    deceasedDateTime: fhirDateTime.optional(),
    address: z.array(Address).optional(),
    managingOrganization: Reference.optional(),
  })
  .passthrough();
export type Patient = z.infer<typeof Patient>;

registerResource('Patient', Patient);
