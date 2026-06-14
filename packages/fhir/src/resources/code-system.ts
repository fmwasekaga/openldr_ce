import { z } from 'zod';
import { fhirId } from '../datatypes/primitives';
import { Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

const ConceptProperty = z.object({ code: z.string(), valueString: z.string().optional(), valueCode: z.string().optional() }).passthrough();
const Concept = z.object({ code: z.string(), display: z.string().optional(), property: z.array(ConceptProperty).optional() }).passthrough();

export const CodeSystem = z
  .object({
    resourceType: z.literal('CodeSystem'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    url: z.string(),
    version: z.string().optional(),
    name: z.string().optional(),
    status: z.string(),
    content: z.enum(['not-present', 'example', 'fragment', 'complete', 'supplement']),
    concept: z.array(Concept).optional(),
  })
  .passthrough();
export type CodeSystem = z.infer<typeof CodeSystem>;

registerResource('CodeSystem', CodeSystem);
