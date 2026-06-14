import type { ReportResult, WidgetConfig } from '../../api';
export function KpiWidget({ config, result }: { config: WidgetConfig; result: ReportResult }) {
  const v = result.rows[0]?.value ?? (result.chart.type === 'stat' ? result.chart.value : 0);
  return (
    <div className="flex h-full flex-col justify-center px-4">
      <div className="text-4xl font-semibold text-primary">{String(v)}{(config.visual.suffix as string) ?? ''}</div>
      <div className="text-sm text-muted-foreground">{config.title}</div>
    </div>
  );
}
