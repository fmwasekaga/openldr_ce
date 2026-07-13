import { describe, expect, it } from 'vitest';
import { projectResource, v2TableForResourceType } from './index';

describe('relational projectResource', () => {
  it('maps Patient -> v2_patients (denormalized, sex code)', () => {
    const out = projectResource({ resourceType: 'Patient', id: 'p1', identifier: [{ value: 'MRN-1' }], name: [{ family: 'Doe', given: ['Jane'] }], gender: 'female', birthDate: '1990-01-01', telecom: [{ system: 'phone', value: '123' }], managingOrganization: { reference: 'Organization/org-1' } });
    expect(out?.table).toBe('v2_patients');
    expect(out?.row).toMatchObject({ id: 'p1', patient_guid: 'MRN-1', surname: 'Doe', firstname: 'Jane', sex: 'F', date_of_birth: '1990-01-01', phone: '123', managing_organization: 'Organization/org-1' });
  });

  it('maps ServiceRequest -> v2_lab_requests (soft patient_id, denormalized code+system)', () => {
    const out = projectResource({ resourceType: 'ServiceRequest', id: 'sr1', identifier: [{ value: 'ACC-1' }], status: 'active', priority: 'routine', authoredOn: '2026-01-01', subject: { reference: 'Patient/p1' }, code: { coding: [{ system: 'http://loinc.org', code: '100', display: 'CBC' }] } });
    expect(out?.table).toBe('v2_lab_requests');
    expect(out?.row).toMatchObject({ id: 'sr1', request_id: 'ACC-1', patient_id: 'p1', panel_code: '100', panel_system: 'http://loinc.org', panel_desc: 'CBC', status: 'active', priority: 'routine', authored_at: '2026-01-01' });
  });

  it('maps Observation -> v2_lab_results (numeric result, soft request_id)', () => {
    const out = projectResource({ resourceType: 'Observation', id: 'o1', basedOn: [{ reference: 'ServiceRequest/sr1' }], code: { coding: [{ system: 'http://loinc.org', code: '200', display: 'Glucose' }] }, valueQuantity: { value: 5.5, unit: 'mmol/L' }, interpretation: [{ coding: [{ code: 'H' }] }], effectiveDateTime: '2026-01-02' });
    expect(out?.table).toBe('v2_lab_results');
    expect(out?.row).toMatchObject({ id: 'o1', request_id: 'sr1', observation_code: '200', observation_system: 'http://loinc.org', result_type: 'NM', numeric_value: 5.5, numeric_units: 'mmol/L', abnormal_flag: 'H', result_timestamp: '2026-01-02' });
  });

  it('maps Organization and Location -> v2_facilities with a source discriminator', () => {
    const org = projectResource({ resourceType: 'Organization', id: 'org1', identifier: [{ value: 'F1' }], name: 'Central Lab', type: [{ text: 'lab' }] });
    expect(org).toMatchObject({ table: 'v2_facilities', row: { id: 'org1', facility_code: 'F1', facility_name: 'Central Lab', facility_type: 'lab', source_resource: 'Organization' } });
    const loc = projectResource({ resourceType: 'Location', id: 'loc1', name: 'Ward A' });
    expect(loc).toMatchObject({ table: 'v2_facilities', row: { id: 'loc1', facility_name: 'Ward A', source_resource: 'Location' } });
  });

  it('returns null for non-projected types', () => {
    expect(projectResource({ resourceType: 'Bundle' })).toBeNull();
    expect(v2TableForResourceType('Bundle')).toBeNull();
    expect(v2TableForResourceType('Patient')).toBe('v2_patients');
  });
});
