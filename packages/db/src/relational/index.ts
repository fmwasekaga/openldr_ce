import type { Provenance } from '../provenance';
import type { ExternalSchema } from '../schema/external';
import { projectPatient } from './patient';
import { projectServiceRequest } from './service-request';
import { projectObservation } from './observation';
import { projectFacility } from './facility';

export * from './patient';
export * from './service-request';
export * from './observation';
export * from './facility';

export interface RelationalResult {
  table: keyof ExternalSchema;
  row: Record<string, unknown>;
}

export function projectResource(resource: unknown, prov: Provenance = {}): RelationalResult | null {
  if (typeof resource !== 'object' || resource === null) return null;
  const r = resource as Record<string, unknown>;
  switch (r['resourceType']) {
    case 'Patient': return { table: 'v2_patients', row: projectPatient(r, prov) };
    case 'ServiceRequest': return { table: 'v2_lab_requests', row: projectServiceRequest(r, prov) };
    case 'Observation': return { table: 'v2_lab_results', row: projectObservation(r, prov) };
    case 'Organization':
    case 'Location': return { table: 'v2_facilities', row: projectFacility(r, prov) };
    default: return null;
  }
}

export function v2TableForResourceType(resourceType: string): keyof ExternalSchema | null {
  switch (resourceType) {
    case 'Patient': return 'v2_patients';
    case 'ServiceRequest': return 'v2_lab_requests';
    case 'Observation': return 'v2_lab_results';
    case 'Organization':
    case 'Location': return 'v2_facilities';
    default: return null;
  }
}
