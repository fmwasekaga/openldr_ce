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
    let code: string;
    if (i.code === 'invalid_type' && (i as { received?: string }).received === 'undefined') {
      code = 'structure';
    } else if (i.code === 'invalid_type') {
      code = 'invalid';
    } else {
      code = 'invalid';
    }
    return {
      severity: 'error',
      code,
      diagnostics: i.message,
      expression: [i.path.length ? i.path.join('.') : '(root)'],
    };
  });
}
