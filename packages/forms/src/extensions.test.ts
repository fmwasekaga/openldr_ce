import { describe, expect, it } from 'vitest';
import { EXT_SDC_OBSERVATION_EXTRACT, EXT_QUESTIONNAIRE_UNIT } from './extensions';
describe('extensions', () => {
  it('uses the SDC observation-extract url', () => {
    expect(EXT_SDC_OBSERVATION_EXTRACT).toBe('http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-observationExtract');
  });
  it('uses the standard questionnaire unit url', () => {
    expect(EXT_QUESTIONNAIRE_UNIT).toBe('http://hl7.org/fhir/StructureDefinition/questionnaire-unit');
  });
});
