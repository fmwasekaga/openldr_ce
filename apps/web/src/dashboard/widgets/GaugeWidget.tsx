import type { ReportResult, WidgetConfig } from '../../api';
export function GaugeWidget({ config, result }: { config: WidgetConfig; result: ReportResult }) {
  const value = Number(result.rows[0]?.value ?? 0);
  const min = Number(config.visual.minValue ?? 0); const max = Number(config.visual.maxValue ?? 100);
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const angle = -90 + pct * 180;
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <svg viewBox="0 0 100 60" className="w-40">
        <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="var(--border)" strokeWidth="8" />
        <line x1="50" y1="50" x2="50" y2="15" stroke="var(--brand)" strokeWidth="3" transform={`rotate(${angle} 50 50)`} />
      </svg>
      <div className="text-lg font-medium">{value}</div>
    </div>
  );
}
