import type { ComputedMetric } from './lib/report-summary';

export function ReportSummaryStrip({ metrics }: { metrics: ComputedMetric[] }) {
  if (metrics.length === 0) return null;
  return (
    <div className="flex flex-wrap border-b border-border">
      {metrics.map((m, i) => (
        <div key={m.id} className={`px-4 py-2.5 ${i > 0 ? 'border-l border-border' : ''}`}>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
          <div className="text-lg font-semibold tabular-nums">{m.value}</div>
        </div>
      ))}
    </div>
  );
}
