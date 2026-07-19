import type { OperationOutcomeIssue } from '../operation-outcome';
import type { FhirResource } from '../validate';

export type StrictnessLevel = 'low' | 'medium' | 'high';

export const LEVEL_RANK: Record<StrictnessLevel, number> = { low: 0, medium: 1, high: 2 };

/** True when `level` is at least as strict as `min`. */
export function levelAtLeast(level: StrictnessLevel, min: StrictnessLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[min];
}

export interface RuleContext {
  level: StrictnessLevel;
  /** Every resource in the current persist batch (already structurally valid). */
  batch: FhirResource[];
  /** Does a ServiceRequest with this id already exist in the store? Injected by the caller. */
  resolveServiceRequest(id: string): Promise<boolean>;
}

export interface ClinicalRule {
  id: string;
  description: string;
  /** Lowest level at which this rule runs. */
  minLevel: StrictnessLevel;
  appliesTo(resource: FhirResource): boolean;
  check(resource: FhirResource, ctx: RuleContext): Promise<OperationOutcomeIssue[]> | OperationOutcomeIssue[];
}
