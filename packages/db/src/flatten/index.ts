import type { Provenance } from '../provenance';
import type { ExternalSchema } from '../schema/external';
import { flattenPatient } from './patient';
import { flattenSpecimen } from './specimen';
import { flattenServiceRequest } from './service-request';
import { flattenDiagnosticReport } from './diagnostic-report';
import { flattenObservation } from './observation';
import { flattenOrganization } from './organization';
import { flattenLocation } from './location';

export * from './patient';
export * from './specimen';
export * from './service-request';
export * from './diagnostic-report';
export * from './observation';
export * from './organization';
export * from './location';

export interface FlatResult {
  table: keyof ExternalSchema;
  row: Record<string, unknown>;
}

export function flattenResource(resource: unknown, prov: Provenance = {}): FlatResult | null {
  if (typeof resource !== 'object' || resource === null) return null;
  const r = resource as Record<string, unknown>;
  switch (r['resourceType']) {
    case 'Patient':
      return { table: 'patients', row: flattenPatient(r, prov) };
    case 'Specimen':
      return { table: 'specimens', row: flattenSpecimen(r, prov) };
    case 'ServiceRequest':
      return { table: 'service_requests', row: flattenServiceRequest(r, prov) };
    case 'DiagnosticReport':
      return { table: 'diagnostic_reports', row: flattenDiagnosticReport(r, prov) };
    case 'Observation':
      return { table: 'observations', row: flattenObservation(r, prov) };
    case 'Organization':
      return { table: 'organizations', row: flattenOrganization(r, prov) };
    case 'Location':
      return { table: 'locations', row: flattenLocation(r, prov) };
    default:
      return null;
  }
}

export function tableForResourceType(resourceType: string): keyof ExternalSchema | null {
  switch (resourceType) {
    case 'Patient': return 'patients';
    case 'Specimen': return 'specimens';
    case 'ServiceRequest': return 'service_requests';
    case 'DiagnosticReport': return 'diagnostic_reports';
    case 'Observation': return 'observations';
    case 'Organization': return 'organizations';
    case 'Location': return 'locations';
    default: return null;
  }
}
