import type { ReportResult, WidgetConfig } from '../../api';
import { ChartWidget } from './ChartWidget';
import { KpiWidget } from './KpiWidget';
import { GaugeWidget } from './GaugeWidget';
import { ProgressWidget } from './ProgressWidget';
import { TrafficLightWidget } from './TrafficLightWidget';
import { TableWidget } from './TableWidget';

export function renderWidget(config: WidgetConfig, result: ReportResult) {
  switch (config.type) {
    case 'kpi': return <KpiWidget config={config} result={result} />;
    case 'gauge': return <GaugeWidget config={config} result={result} />;
    case 'progress-bar': return <ProgressWidget config={config} result={result} />;
    case 'traffic-light': return <TrafficLightWidget config={config} result={result} />;
    case 'table': return <TableWidget result={result} />;
    default: return <ChartWidget config={config} result={result} />;
  }
}
