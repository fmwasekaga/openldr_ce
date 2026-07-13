import { describe, expect, it } from 'vitest';
import { projectResource, tableForResourceType } from './index';

describe('relational projectResource', () => {
  it('maps Patient -> patients (denormalized, sex code)', () => {
    const out = projectResource({ resourceType: 'Patient', id: 'p1', identifier: [{ value: 'MRN-1' }], name: [{ family: 'Doe', given: ['Jane'] }], gender: 'female', birthDate: '1990-01-01', telecom: [{ system: 'phone', value: '123' }], managingOrganization: { reference: 'Organization/org-1' } });
    expect(out?.table).toBe('patients');
    expect(out?.row).toMatchObject({ id: 'p1', patient_guid: 'MRN-1', surname: 'Doe', firstname: 'Jane', sex: 'F', date_of_birth: '1990-01-01', phone: '123', managing_organization: 'Organization/org-1' });
  });

  it('maps ServiceRequest -> lab_requests (soft patient_id, denormalized code+system)', () => {
    const out = projectResource({ resourceType: 'ServiceRequest', id: 'sr1', identifier: [{ value: 'ACC-1' }], status: 'active', priority: 'routine', authoredOn: '2026-01-01', subject: { reference: 'Patient/p1' }, code: { coding: [{ system: 'http://loinc.org', code: '100', display: 'CBC' }] } });
    expect(out?.table).toBe('lab_requests');
    expect(out?.row).toMatchObject({ id: 'sr1', request_id: 'ACC-1', patient_id: 'p1', panel_code: '100', panel_system: 'http://loinc.org', panel_desc: 'CBC', status: 'active', priority: 'routine', authored_at: '2026-01-01' });
  });

  it('maps Observation -> lab_results (numeric result, soft request_id)', () => {
    const out = projectResource({ resourceType: 'Observation', id: 'o1', basedOn: [{ reference: 'ServiceRequest/sr1' }], subject: { reference: 'Patient/pt-1' }, specimen: { reference: 'Specimen/sp-1' }, code: { coding: [{ system: 'http://loinc.org', code: '200', display: 'Glucose' }] }, valueQuantity: { value: 5.5, unit: 'mmol/L' }, interpretation: [{ coding: [{ code: 'H' }] }], effectiveDateTime: '2026-01-02' });
    expect(out?.table).toBe('lab_results');
    expect(out?.row).toMatchObject({ id: 'o1', request_id: 'sr1', observation_code: '200', observation_system: 'http://loinc.org', result_type: 'NM', numeric_value: 5.5, numeric_units: 'mmol/L', abnormal_flag: 'H', result_timestamp: '2026-01-02', patient_id: 'pt-1', specimen_id: 'sp-1' });
  });

  it('maps Organization and Location -> facilities with a source discriminator', () => {
    const org = projectResource({ resourceType: 'Organization', id: 'org1', identifier: [{ value: 'F1' }], name: 'Central Lab', type: [{ text: 'lab' }] });
    expect(org).toMatchObject({ table: 'facilities', row: { id: 'org1', facility_code: 'F1', facility_name: 'Central Lab', facility_type: 'lab', source_resource: 'Organization' } });
    const loc = projectResource({ resourceType: 'Location', id: 'loc1', name: 'Ward A' });
    expect(loc).toMatchObject({ table: 'facilities', row: { id: 'loc1', facility_name: 'Ward A', source_resource: 'Location' } });
  });

  it('maps Specimen -> specimens (bare patient_id, received_time)', () => {
    const out = projectResource({ resourceType: 'Specimen', id: 'sp1', subject: { reference: 'Patient/p1' }, receivedTime: '2026-01-01T00:00:00Z', type: { text: 'Blood' }, status: 'available' });
    expect(out?.table).toBe('specimens');
    expect(out?.row).toMatchObject({ id: 'sp1', patient_id: 'p1', received_time: '2026-01-01T00:00:00Z', type_text: 'Blood', status: 'available' });
  });

  it('maps Specimen -> specimens (origin extension)', () => {
    const out = projectResource({
      resourceType: 'Specimen',
      id: 'sp2',
      subject: { reference: 'Patient/p1' },
      receivedTime: '2026-01-01T00:00:00Z',
      type: { text: 'Blood' },
      status: 'available',
      extension: [{ url: 'https://openldr.org/fhir/StructureDefinition/specimen-origin', valueCode: 'inpatient' }],
    });
    expect(out?.table).toBe('specimens');
    expect(out?.row).toMatchObject({ id: 'sp2', origin: 'inpatient' });
  });

  it('maps DiagnosticReport -> diagnostic_reports (bare patient_id, code, issued)', () => {
    const out = projectResource({ resourceType: 'DiagnosticReport', id: 'dr1', subject: { reference: 'Patient/p1' }, status: 'final', code: { coding: [{ code: 'CBC' }], text: 'Complete Blood Count' }, issued: '2026-01-02T00:00:00Z', conclusion: 'ok' });
    expect(out?.table).toBe('diagnostic_reports');
    expect(out?.row).toMatchObject({ id: 'dr1', patient_id: 'p1', status: 'final', code_code: 'CBC', code_text: 'Complete Blood Count', issued: '2026-01-02T00:00:00Z', conclusion: 'ok' });
  });

  it('returns null for non-projected types', () => {
    expect(projectResource({ resourceType: 'Bundle' })).toBeNull();
    expect(tableForResourceType('Bundle')).toBeNull();
    expect(tableForResourceType('Patient')).toBe('patients');
    expect(tableForResourceType('Specimen')).toBe('specimens');
    expect(tableForResourceType('DiagnosticReport')).toBe('diagnostic_reports');
  });
});
