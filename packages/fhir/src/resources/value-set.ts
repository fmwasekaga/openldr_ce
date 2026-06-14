import { z } from 'zod';
import { fhirId } from '../datatypes/primitives';
import { Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

const Filter = z.object({ property: z.string(), op: z.string(), value: z.string() }).passthrough();
const IncludeConcept = z.object({ code: z.string(), display: z.string().optional() }).passthrough();
const ComposeRule = z.object({ system: z.string().optional(), concept: z.array(IncludeConcept).optional(), filter: z.array(Filter).optional() }).passthrough();
const Contains = z.object({ system: z.string().optional(), code: z.string().optional(), display: z.string().optional() }).passthrough();

export const ValueSet = z
  .object({
    resourceType: z.literal('ValueSet'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    url: z.string(),
    version: z.string().optional(),
    name: z.string().optional(),
    status: z.string(),
    compose: z.object({ include: z.array(ComposeRule), exclude: z.array(ComposeRule).optional() }).optional(),
    expansion: z.object({ total: z.number().optional(), offset: z.number().optional(), contains: z.array(Contains).optional() }).optional(),
  })
  .passthrough();
export type ValueSet = z.infer<typeof ValueSet>;

registerResource('ValueSet', ValueSet);
