import { describe, it, expect } from 'vitest';
import { validateResource } from '../validate';
import { listResourceTypes } from '../registry';

describe('Questionnaire / QuestionnaireResponse', () => {
  it('validates a Questionnaire with nested items', () => {
    const r = validateResource({
      resourceType: 'Questionnaire',
      status: 'active',
      item: [{ linkId: 's1', type: 'group', item: [{ linkId: 'f1', type: 'string', text: 'Name' }] }],
    });
    expect(r.ok).toBe(true);
  });
  it('rejects a Questionnaire missing status', () => {
    const r = validateResource({ resourceType: 'Questionnaire' });
    expect(r.ok).toBe(false);
  });
  it('validates a QuestionnaireResponse', () => {
    const r = validateResource({
      resourceType: 'QuestionnaireResponse',
      status: 'completed',
      item: [{ linkId: 'f1', answer: [{ valueString: 'Jane' }] }],
    });
    expect(r.ok).toBe(true);
  });
  it('registers both resource types', () => {
    const types = listResourceTypes();
    expect(types).toContain('Questionnaire');
    expect(types).toContain('QuestionnaireResponse');
  });
});
