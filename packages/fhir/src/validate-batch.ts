import { validateResource, type FhirResource } from './validate';
import { outcomeFromIssues, type OperationOutcome, type OperationOutcomeIssue } from './operation-outcome';
import { CLINICAL_RULES, levelAtLeast, type StrictnessLevel } from './rules';

export interface ValidateBatchOpts {
  level: StrictnessLevel;
  resolveServiceRequest(id: string): Promise<boolean>;
}

export type ValidateBatchResult =
  | { ok: true; resources: FhirResource[] }
  | { ok: false; outcome: OperationOutcome };

export async function validateBatch(resources: unknown[], opts: ValidateBatchOpts): Promise<ValidateBatchResult> {
  const issues: OperationOutcomeIssue[] = [];
  const valid: FhirResource[] = [];

  // 1) Structural — always.
  for (const r of resources) {
    const res = validateResource(r);
    if (res.ok) valid.push(res.resource);
    else issues.push(...res.outcome.issue);
  }
  if (issues.length > 0) return { ok: false, outcome: outcomeFromIssues(issues) };

  // 2) Clinical rules at/below the active level.
  const rules = CLINICAL_RULES.filter((rule) => levelAtLeast(opts.level, rule.minLevel));
  const ctx = { level: opts.level, batch: valid, resolveServiceRequest: opts.resolveServiceRequest };
  for (const resource of valid) {
    for (const rule of rules) {
      if (!rule.appliesTo(resource)) continue;
      issues.push(...(await rule.check(resource, ctx)));
    }
  }
  if (issues.length > 0) return { ok: false, outcome: outcomeFromIssues(issues) };
  return { ok: true, resources: valid };
}
