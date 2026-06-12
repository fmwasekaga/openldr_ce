import type { z } from 'zod';

export type IssueSeverity = 'fatal' | 'error' | 'warning' | 'information';

export interface OperationOutcomeIssue {
  severity: IssueSeverity;
  code: string;
  diagnostics?: string;
  expression?: string[];
}

export interface OperationOutcome {
  resourceType: 'OperationOutcome';
  issue: OperationOutcomeIssue[];
}

export function outcomeFromIssues(issues: OperationOutcomeIssue[]): OperationOutcome {
  return { resourceType: 'OperationOutcome', issue: issues };
}

export function singleIssueOutcome(
  severity: IssueSeverity,
  code: string,
  diagnostics: string,
  expression?: string[],
): OperationOutcome {
  return outcomeFromIssues([{ severity, code, diagnostics, ...(expression ? { expression } : {}) }]);
}

export function issuesFromZodError(error: z.ZodError): OperationOutcomeIssue[] {
  return error.issues.map((i) => {
    // A missing required field is a structural issue; a present-but-wrong value is invalid.
    const missing = i.code === 'invalid_type' && i.received === 'undefined';
    return {
      severity: 'error' as const,
      code: missing ? 'structure' : 'invalid',
      diagnostics: i.message,
      expression: [i.path.length ? i.path.join('.') : '(root)'],
    };
  });
}
