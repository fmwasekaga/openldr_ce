import { z } from 'zod';
import { fhirId } from '../datatypes/primitives';
import { Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

const Target = z.object({ code: z.string(), display: z.string().optional(), equivalence: z.string().optional() }).passthrough();
const Element = z.object({ code: z.string(), display: z.string().optional(), target: z.array(Target).optional() }).passthrough();
const Group = z.object({ source: z.string().optional(), target: z.string().optional(), element: z.array(Element) }).passthrough();

export const ConceptMap = z
  .object({
    resourceType: z.literal('ConceptMap'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    url: z.string(),
    version: z.string().optional(),
    name: z.string().optional(),
    status: z.string(),
    sourceUri: z.string().optional(),
    targetUri: z.string().optional(),
    group: z.array(Group).optional(),
  })
  .passthrough();
export type ConceptMap = z.infer<typeof ConceptMap>;

registerResource('ConceptMap', ConceptMap);
