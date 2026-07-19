import type { CodeableConcept, Reference } from '../datatypes/complex';
import type { OperationOutcomeIssue } from '../operation-outcome';
import type { FhirResource } from '../validate';
import { levelAtLeast, type ClinicalRule, type RuleContext } from './types';

function hasCategoryCode(resource: FhirResource, code: string): boolean {
  const cats = (resource as { category?: CodeableConcept[] }).category ?? [];
  return cats.some((c) => (c.coding ?? []).some((cd) => cd.code === code));
}

function isLabResult(resource: FhirResource): boolean {
  if (resource.resourceType === 'Observation') return hasCategoryCode(resource, 'laboratory');
  if (resource.resourceType === 'DiagnosticReport') return hasCategoryCode(resource, 'LAB');
  return false;
}

/** Extract ServiceRequest ids referenced by basedOn (reference "ServiceRequest/<id>" or type). */
function serviceRequestRefs(resource: FhirResource): string[] {
  const based = (resource as { basedOn?: Reference[] }).basedOn ?? [];
  return based
    .map((r) => {
      const ref = r.reference ?? '';
      if (ref.startsWith('ServiceRequest/')) return ref.slice('ServiceRequest/'.length);
      if (r.type === 'ServiceRequest' && ref) return ref;
      return null;
    })
    .filter((x): x is string => x != null);
}

export const resultRequiresRequest: ClinicalRule = {
  id: 'result-requires-request',
  description:
    'A laboratory result (Observation category=laboratory, or DiagnosticReport category=LAB) must be linked to a ServiceRequest via basedOn.',
  minLevel: 'medium',
  appliesTo: isLabResult,
  async check(resource, ctx: RuleContext) {
    const expr = [`${resource.resourceType}/${(resource as { id?: string }).id ?? '?'}.basedOn`];
    const refs = serviceRequestRefs(resource);
    if (refs.length === 0) {
      const issue: OperationOutcomeIssue = {
        severity: 'error',
        code: 'required',
        diagnostics: 'laboratory result must reference a ServiceRequest (basedOn)',
        expression: expr,
      };
      return [issue];
    }
    if (!levelAtLeast(ctx.level, 'high')) return []; // medium: presence is enough
    const inBatch = new Set(
      ctx.batch.filter((r) => r.resourceType === 'ServiceRequest').map((r) => (r as { id?: string }).id),
    );
    for (const id of refs) {
      if (inBatch.has(id)) return [];
      if (await ctx.resolveServiceRequest(id)) return [];
    }
    const issue: OperationOutcomeIssue = {
      severity: 'error',
      code: 'not-found',
      diagnostics: `basedOn ServiceRequest not found in batch or store: ${refs.join(', ')}`,
      expression: expr,
    };
    return [issue];
  },
};
