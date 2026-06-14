import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  ScatterChart, Scatter, FunnelChart, Funnel, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { ReportResult, WidgetConfig } from '../../api';

const COLORS = ['#4682B4', '#5A9BD6', '#22c55e', '#f59e0b', '#ef4444', '#898989'];

export function ChartWidget({ config, result }: { config: WidgetConfig; result: ReportResult }) {
  const rows = result.rows;
  const x = (config.visual.xAxisKey as string) ?? 'label';
  const y = (config.visual.yAxisKey as string) ?? 'value';
  const color = (config.visual.color as string) ?? 'var(--brand)';
  switch (config.type) {
    case 'line-chart':
      return <ResponsiveContainer><LineChart data={rows}><CartesianGrid stroke="var(--border)" /><XAxis dataKey={x} stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip /><Line type="monotone" dataKey={y} stroke={color} /></LineChart></ResponsiveContainer>;
    case 'area-chart':
      return <ResponsiveContainer><AreaChart data={rows}><CartesianGrid stroke="var(--border)" /><XAxis dataKey={x} stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip /><Area type="monotone" dataKey={y} stroke={color} fill={color} fillOpacity={0.3} /></AreaChart></ResponsiveContainer>;
    case 'row-chart':
      return <ResponsiveContainer><BarChart data={rows} layout="vertical"><CartesianGrid stroke="var(--border)" /><XAxis type="number" stroke="var(--text-muted)" /><YAxis type="category" dataKey={x} stroke="var(--text-muted)" /><Tooltip /><Bar dataKey={y} fill={color} /></BarChart></ResponsiveContainer>;
    case 'pie-chart':
      return <ResponsiveContainer><PieChart><Pie data={rows} dataKey={y} nameKey={x} outerRadius="80%" innerRadius={(config.visual.innerRadius as number) ?? 0} label>{rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer>;
    case 'scatter-plot':
      return <ResponsiveContainer><ScatterChart><CartesianGrid stroke="var(--border)" /><XAxis dataKey={x} stroke="var(--text-muted)" /><YAxis dataKey={y} stroke="var(--text-muted)" /><ZAxis dataKey={(config.visual.sizeKey as string) ?? undefined} range={[40, 200]} /><Tooltip /><Scatter data={rows} fill={color} /></ScatterChart></ResponsiveContainer>;
    case 'funnel':
      return <ResponsiveContainer><FunnelChart><Tooltip /><Funnel data={rows} dataKey={y} nameKey={x}>{rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Funnel></FunnelChart></ResponsiveContainer>;
    default:
      return <ResponsiveContainer><BarChart data={rows}><CartesianGrid stroke="var(--border)" /><XAxis dataKey={x} stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip /><Bar dataKey={y} fill={color} /></BarChart></ResponsiveContainer>;
  }
}
