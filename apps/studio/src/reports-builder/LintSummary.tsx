import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { ReportLintIssue } from '@openldr/report-builder/pure';

export function LintSummary({ issues, onSelectBlock }: { issues: ReportLintIssue[]; onSelectBlock?: (row: number, cell: number) => void }): JSX.Element | null {
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  const tone = errors > 0 ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-amber-500/40 bg-amber-500/10 text-amber-700';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Lint issues" className={`rounded-md border px-2 py-1 text-xs ${tone}`}>
          {errors} errors, {warnings} warnings
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 text-xs">
        <ul className="max-h-64 divide-y divide-border overflow-y-auto">
          {issues.map((iss, i) => {
            const locatable = iss.rowIndex !== undefined && iss.cellIndex !== undefined && !!onSelectBlock;
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={!locatable}
                  onClick={() => { if (iss.rowIndex !== undefined && iss.cellIndex !== undefined) onSelectBlock?.(iss.rowIndex, iss.cellIndex); }}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className={iss.severity === 'error' ? 'text-destructive' : 'text-amber-600'}>{iss.severity === 'error' ? '●' : '▲'}</span>
                  <span className="text-foreground">{iss.message}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
