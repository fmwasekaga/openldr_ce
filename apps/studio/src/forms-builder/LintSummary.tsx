import type { FormLintIssue } from '@openldr/forms/pure';

export function LintSummary({ issues }: { issues: FormLintIssue[] }): JSX.Element | null {
  if (issues.length === 0) return null;
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
      {errors} errors, {warnings} warnings
    </div>
  );
}
