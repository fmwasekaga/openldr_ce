import { describe, it, expect } from 'vitest';
import { projectQuestionnaireResponse } from './questionnaire-response';
import { projectResource } from './index';

const qr = {
  resourceType: 'QuestionnaireResponse',
  id: 'qr1',
  status: 'completed',
  questionnaire: 'urn:openldr:form:hiv_vl_documentation',
  subject: { reference: 'Patient/p1' },
  authored: '2026-01-01T00:00:00+02:00',
  basedOn: [{ reference: 'ServiceRequest/req1-obr1' }],
  item: [{ linkId: 'VL_REASON', text: 'VL reason', answer: [{ valueString: 'Routine' }] }],
};

describe('projectQuestionnaireResponse', () => {
  it('maps a QR into a questionnaire_responses row', () => {
    const row = projectQuestionnaireResponse(qr, { sourceSystem: 'disa', batchId: 'b1' });
    expect(row).toMatchObject({
      id: 'qr1',
      questionnaire: 'urn:openldr:form:hiv_vl_documentation',
      form_code: 'hiv_vl_documentation',
      subject_id: 'p1',
      authored: '2026-01-01T00:00:00+02:00',
      based_on_id: 'req1-obr1',
      source_system: 'disa',
      batch_id: 'b1',
    });
    expect(JSON.parse(row.items!)).toEqual(qr.item);
  });

  it('documentation-only QR has null based_on_id', () => {
    const { basedOn, ...noBasedOn } = qr;
    const row = projectQuestionnaireResponse(noBasedOn, {});
    expect(row.based_on_id).toBeNull();
  });

  it('projectResource routes QuestionnaireResponse to questionnaire_responses', () => {
    const p = projectResource(qr, {});
    expect(p?.table).toBe('questionnaire_responses');
  });
});
