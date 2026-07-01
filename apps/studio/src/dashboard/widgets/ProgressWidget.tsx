import type { ReportResult, WidgetConfig } from '../../api';
export function ProgressWidget({ config, result }: { config: WidgetConfig; result: ReportResult }) {
  const yKey = (config.visual.yAxisKey as string) ?? 'value';
  const row = result.rows?.[0] ?? {};
  const value = Number(row[yKey] ?? Object.values(row)[0] ?? 0);
  const goal = Number(config.visual.goalValue ?? 100);
  const pct = Math.max(0, Math.min(100, (value / (goal || 1)) * 100));
  return (
    <div className="flex h-full flex-col justify-center gap-2 px-4">
      <div className="flex justify-between text-sm"><span>{config.title}</span><span>{value} / {goal}</span></div>
      <div className="h-3 w-full rounded bg-muted"><div className="h-3 rounded bg-primary" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
