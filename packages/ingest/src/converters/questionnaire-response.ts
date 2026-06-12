import type { FhirResource, Questionnaire, QuestionnaireResponse } from '@openldr/fhir';
import { extractResources } from '@openldr/forms';
import type { Converter } from '../converter';

const decoder = new TextDecoder();

export const questionnaireResponseConverter: Converter = {
  id: 'questionnaire-response',
  version: '1',
  async convert(raw): Promise<FhirResource[]> {
    const data = JSON.parse(decoder.decode(raw)) as { questionnaire?: Questionnaire; response?: QuestionnaireResponse };
    if (!data.questionnaire || !data.response) {
      throw new Error('payload must be { questionnaire, response }');
    }
    const { resources, invalid } = extractResources(data.response, data.questionnaire, {});
    if (invalid.length > 0) {
      throw new Error(`extraction produced ${invalid.length} invalid resource(s)`);
    }
    return resources;
  },
};
