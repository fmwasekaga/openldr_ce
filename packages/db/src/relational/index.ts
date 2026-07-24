import type { Provenance } from '../provenance';
import type { ExternalSchema } from '../schema/external';
import { projectPatient } from './patient';
import { projectServiceRequest } from './service-request';
import { projectObservation } from './observation';
import { projectFacility } from './facility';
import { projectSpecimen } from './specimen';
import { projectDiagnosticReport } from './diagnostic-report';
import { projectQuestionnaireResponse } from './questionnaire-response';

export * from './patient';
export * from './service-request';
export * from './observation';
export * from './facility';
export * from './specimen';
export * from './diagnostic-report';
export * from './questionnaire-response';

export interface RelationalResult {
  table: keyof ExternalSchema;
  row: Record<string, unknown>;
}

export function projectResource(resource: unknown, prov: Provenance = {}): RelationalResult | null {
  if (typeof resource !== 'object' || resource === null) return null;
  const r = resource as Record<string, unknown>;
  switch (r['resourceType']) {
    case 'Patient': return { table: 'patients', row: projectPatient(r, prov) };
    case 'ServiceRequest': return { table: 'lab_requests', row: projectServiceRequest(r, prov) };
    case 'Observation': return { table: 'lab_results', row: projectObservation(r, prov) };
    case 'Organization':
    case 'Location': return { table: 'facilities', row: projectFacility(r, prov) };
    case 'Specimen': return { table: 'specimens', row: projectSpecimen(r, prov) };
    case 'DiagnosticReport': return { table: 'diagnostic_reports', row: projectDiagnosticReport(r, prov) };
    case 'QuestionnaireResponse': return { table: 'questionnaire_responses', row: projectQuestionnaireResponse(r, prov) };
    default: return null;
  }
}

export function tableForResourceType(resourceType: string): keyof ExternalSchema | null {
  switch (resourceType) {
    case 'Patient': return 'patients';
    case 'ServiceRequest': return 'lab_requests';
    case 'Observation': return 'lab_results';
    case 'Organization':
    case 'Location': return 'facilities';
    case 'Specimen': return 'specimens';
    case 'DiagnosticReport': return 'diagnostic_reports';
    case 'QuestionnaireResponse': return 'questionnaire_responses';
    default: return null;
  }
}
