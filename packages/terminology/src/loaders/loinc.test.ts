import { describe, it, expect } from 'vitest';
import { loincRowToConcept } from './loinc';

describe('loincRowToConcept', () => {
  it('maps a LOINC CSV row to a concept', () => {
    const c = loincRowToConcept({
      LOINC_NUM: '2160-0',
      LONG_COMMON_NAME: 'Creatinine [Mass/volume] in Serum or Plasma',
      STATUS: 'ACTIVE',
      COMPONENT: 'Creatinine',
      PROPERTY: 'MCnc',
      SYSTEM: 'Ser/Plas',
      SCALE_TYP: 'Qn',
      METHOD_TYP: '',
      CLASS: 'CHEM',
    });
    expect(c.system).toBe('http://loinc.org');
    expect(c.code).toBe('2160-0');
    expect(c.display).toBe('Creatinine [Mass/volume] in Serum or Plasma');
    expect(c.status).toBe('ACTIVE');
    expect(c.properties).toMatchObject({ COMPONENT: 'Creatinine', CLASS: 'CHEM' });
  });
});
