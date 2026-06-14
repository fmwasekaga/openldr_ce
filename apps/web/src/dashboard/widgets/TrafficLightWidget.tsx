import type { ReportResult, WidgetConfig } from '../../api';
export function TrafficLightWidget({ config, result }: { config: WidgetConfig; result: ReportResult }) {
  const value = Number(result.rows[0]?.value ?? 0);
  const green = Number(config.visual.greenThreshold ?? 90); const amber = Number(config.visual.amberThreshold ?? 70);
  const color = value >= green ? '#22c55e' : value >= amber ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex h-full items-center gap-3 px-4">
      <span className="inline-block h-6 w-6 rounded-full" style={{ background: color }} />
      <div><div className="text-2xl font-semibold">{value}{(config.visual.suffix as string) ?? ''}</div><div className="text-xs text-muted-foreground">{config.title}</div></div>
    </div>
  );
}
