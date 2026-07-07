// apps/studio/src/query/workspace/ResultsGrid.tsx
import type { RunResult } from '../api';

export function ResultsGrid({ result }: { result: Omit<RunResult, 'ms'> | null }): JSX.Element {
  if (!result) return <div className="grid h-full place-items-center text-sm text-muted-foreground">No results</div>;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs font-mono">
        <thead className="sticky top-0 bg-muted">
          <tr>{result.columns.map((c) => (
            <th key={c.key} className="border-b border-border px-3 py-1.5 text-left font-medium text-muted-foreground">{c.label}</th>
          ))}</tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60">
              {result.columns.map((c) => <td key={c.key} className="px-3 py-1.5">{String(r[c.key] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
