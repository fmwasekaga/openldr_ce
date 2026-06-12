import './resources';
import { getResourceSchema } from './registry';
import {
  type OperationOutcome,
  outcomeFromIssues,
  singleIssueOutcome,
  issuesFromZodError,
} from './operation-outcome';

export interface FhirResource {
  resourceType: string;
  [key: string]: unknown;
}

export type ValidationResult =
  | { ok: true; resource: FhirResource }
  | { ok: false; outcome: OperationOutcome };

export function validateResource(data: unknown): ValidationResult {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, outcome: singleIssueOutcome('error', 'structure', 'resource must be a JSON object') };
  }
  const resourceType = (data as Record<string, unknown>)['resourceType'];
  if (typeof resourceType !== 'string') {
    return { ok: false, outcome: singleIssueOutcome('error', 'structure', 'missing resourceType', ['resourceType']) };
  }
  const schema = getResourceSchema(resourceType);
  if (!schema) {
    return {
      ok: false,
      outcome: singleIssueOutcome('error', 'not-supported', `unsupported resourceType: ${resourceType}`, ['resourceType']),
    };
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, outcome: outcomeFromIssues(issuesFromZodError(parsed.error)) };
  }
  return { ok: true, resource: parsed.data as FhirResource };
}

export function validateBundleEntries(bundle: unknown): { entry: number; result: ValidationResult }[] {
  const entries = (bundle as { entry?: { resource?: unknown }[] } | null)?.entry ?? [];
  return entries.map((e, index) => ({ entry: index, result: validateResource(e?.resource) }));
}
