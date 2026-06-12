import { z } from 'zod';
import { fhirId, fhirDateTime } from '../datatypes/primitives';
import { Meta, Reference } from '../datatypes/complex';
import { registerResource } from '../registry';

const QuestionnaireResponseItem: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      linkId: z.string(),
      text: z.string().optional(),
      answer: z.array(z.unknown()).optional(),
      item: z.array(QuestionnaireResponseItem).optional(),
    })
    .passthrough(),
);

export const QuestionnaireResponse = z
  .object({
    resourceType: z.literal('QuestionnaireResponse'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    questionnaire: z.string().optional(),
    status: z.enum(['in-progress', 'completed', 'amended', 'entered-in-error', 'stopped']),
    subject: Reference.optional(),
    authored: fhirDateTime.optional(),
    item: z.array(QuestionnaireResponseItem).optional(),
  })
  .passthrough();
export type QuestionnaireResponse = z.infer<typeof QuestionnaireResponse>;

registerResource('QuestionnaireResponse', QuestionnaireResponse);
