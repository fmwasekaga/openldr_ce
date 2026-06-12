import { z } from 'zod';
import { fhirId } from '../datatypes/primitives';
import { Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

const BundleEntry = z
  .object({
    fullUrl: z.string().optional(),
    resource: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const Bundle = z
  .object({
    resourceType: z.literal('Bundle'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    type: z.enum([
      'document', 'message', 'transaction', 'transaction-response', 'batch', 'batch-response', 'history', 'searchset', 'collection',
    ]),
    total: z.number().int().nonnegative().optional(),
    entry: z.array(BundleEntry).optional(),
  })
  .passthrough();
export type Bundle = z.infer<typeof Bundle>;

registerResource('Bundle', Bundle);
