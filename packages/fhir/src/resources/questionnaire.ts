import { z } from 'zod';
import { fhirId, fhirUri } from '../datatypes/primitives';
import { Meta } from '../datatypes/complex';
import { registerResource } from '../registry';

const QuestionnaireItem: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      linkId: z.string(),
      text: z.string().optional(),
      type: z.enum([
        'group', 'display', 'boolean', 'decimal', 'integer', 'date', 'dateTime', 'time',
        'string', 'text', 'url', 'choice', 'open-choice', 'attachment', 'reference', 'quantity',
      ]),
      required: z.boolean().optional(),
      repeats: z.boolean().optional(),
      answerOption: z.array(z.unknown()).optional(),
      enableWhen: z.array(z.unknown()).optional(),
      extension: z.array(z.unknown()).optional(),
      item: z.array(QuestionnaireItem).optional(),
    })
    .passthrough(),
);

export const Questionnaire = z
  .object({
    resourceType: z.literal('Questionnaire'),
    id: fhirId.optional(),
    meta: Meta.optional(),
    url: fhirUri.optional(),
    name: z.string().optional(),
    title: z.string().optional(),
    status: z.enum(['draft', 'active', 'retired', 'unknown']),
    item: z.array(QuestionnaireItem).optional(),
  })
  .passthrough();
export type Questionnaire = z.infer<typeof Questionnaire>;

registerResource('Questionnaire', Questionnaire);
