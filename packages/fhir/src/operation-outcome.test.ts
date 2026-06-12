import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { singleIssueOutcome, outcomeFromIssues, issuesFromZodError } from './operation-outcome';

describe('operation-outcome', () => {
  it('singleIssueOutcome builds a spec-shaped OperationOutcome', () => {
    const o = singleIssueOutcome('error', 'not-supported', 'nope', ['resourceType']);
    expect(o.resourceType).toBe('OperationOutcome');
    expect(o.issue[0]).toMatchObject({ severity: 'error', code: 'not-supported', diagnostics: 'nope', expression: ['resourceType'] });
  });
  it('issuesFromZodError maps type errors to structure and others to invalid', () => {
    const schema = z.object({ status: z.string(), n: z.number() });
    const res = schema.safeParse({ n: 'x' });
    expect(res.success).toBe(false);
    if (!res.success) {
      const issues = issuesFromZodError(res.error);
      const codes = issues.map((i) => i.code);
      expect(codes).toContain('invalid');
      expect(codes).toContain('structure');
      expect(issues.every((i) => i.severity === 'error')).toBe(true);
    }
  });
  it('outcomeFromIssues wraps issues', () => {
    expect(outcomeFromIssues([{ severity: 'warning', code: 'invalid' }]).issue.length).toBe(1);
  });
});
