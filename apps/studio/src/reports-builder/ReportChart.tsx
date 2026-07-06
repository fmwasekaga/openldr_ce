import { ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { ChartData } from '@openldr/report-builder/pure';

const COLORS = ['#378ADD', '#1D9E75', '#D85A30', '#7F77DD', '#EF9F27', '#D4537E'];
export type ReportChartType = 'bar' | 'line' | 'pie' | 'area' | 'donut' | 'row' | 'scatter';

// Convert { categories, series[] } into recharts row-objects: one row per category with a key per series.
function toRows(data: ChartData): Record<string, unknown>[] {
  return data.categories.map((cat, i) => {
    const row: Record<string, unknown> = { category: cat };
    for (const s of data.series) row[s.name] = s.values[i] ?? 0;
    return row;
  });
}

export function ReportChart({ chartType, data }: { chartType: ReportChartType; data: ChartData }): JSX.Element {
  if (data.categories.length === 0) return <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">No data</div>;
  const rows = toRows(data);
  const multi = data.series.length > 1;

  if (chartType === 'pie' || chartType === 'donut') {
    const pieRows = data.categories.map((cat, i) => ({ category: cat, value: data.series[0]?.values[i] ?? 0 }));
    return (
      <ResponsiveContainer><PieChart>
        <Pie data={pieRows} dataKey="value" nameKey="category" outerRadius="80%" innerRadius={chartType === 'donut' ? '50%' : 0} label>
          {pieRows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie><Tooltip /><Legend />
      </PieChart></ResponsiveContainer>
    );
  }
  if (chartType === 'line') {
    return (
      <ResponsiveContainer><LineChart data={rows}>
        <CartesianGrid stroke="var(--border)" /><XAxis dataKey="category" stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip />
        {multi && <Legend />}
        {data.series.map((s, i) => <Line key={s.name} type="monotone" dataKey={s.name} stroke={COLORS[i % COLORS.length]} />)}
      </LineChart></ResponsiveContainer>
    );
  }
  if (chartType === 'area') {
    return (
      <ResponsiveContainer><AreaChart data={rows}>
        <CartesianGrid stroke="var(--border)" /><XAxis dataKey="category" stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip />
        {multi && <Legend />}
        {data.series.map((s, i) => <Area key={s.name} type="monotone" dataKey={s.name} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.25} />)}
      </AreaChart></ResponsiveContainer>
    );
  }
  if (chartType === 'row') {
    return (
      <ResponsiveContainer><BarChart data={rows} layout="vertical">
        <CartesianGrid stroke="var(--border)" /><XAxis type="number" stroke="var(--text-muted)" /><YAxis type="category" dataKey="category" width={80} stroke="var(--text-muted)" /><Tooltip />
        {multi && <Legend />}
        {data.series.map((s, i) => <Bar key={s.name} dataKey={s.name} fill={COLORS[i % COLORS.length]} />)}
      </BarChart></ResponsiveContainer>
    );
  }
  if (chartType === 'scatter') {
    return (
      <ResponsiveContainer><ScatterChart>
        <CartesianGrid stroke="var(--border)" /><XAxis type="number" dataKey="x" stroke="var(--text-muted)" /><YAxis type="number" dataKey="y" stroke="var(--text-muted)" /><Tooltip />
        {multi && <Legend />}
        {data.series.map((s, i) => (
          <Scatter key={s.name} name={s.name} fill={COLORS[i % COLORS.length]}
            data={data.categories.map((_, ci) => ({ x: ci, y: s.values[ci] ?? 0 }))} />
        ))}
      </ScatterChart></ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer><BarChart data={rows}>
      <CartesianGrid stroke="var(--border)" /><XAxis dataKey="category" stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip />
      {multi && <Legend />}
      {data.series.map((s, i) => <Bar key={s.name} dataKey={s.name} fill={COLORS[i % COLORS.length]} />)}
    </BarChart></ResponsiveContainer>
  );
}
