import { ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { ChartData } from '@openldr/report-builder/pure';

const COLORS = ['#378ADD', '#1D9E75', '#D85A30', '#7F77DD', '#EF9F27', '#D4537E'];

// Convert { categories, series[] } into recharts row-objects: one row per category with a key per series.
function toRows(data: ChartData): Record<string, unknown>[] {
  return data.categories.map((cat, i) => {
    const row: Record<string, unknown> = { category: cat };
    for (const s of data.series) row[s.name] = s.values[i] ?? 0;
    return row;
  });
}

export function ReportChart({ chartType, data }: { chartType: 'bar' | 'line' | 'pie'; data: ChartData }): JSX.Element {
  if (data.categories.length === 0) return <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">No data</div>;
  const rows = toRows(data);
  const multi = data.series.length > 1;

  if (chartType === 'pie') {
    const pieRows = data.categories.map((cat, i) => ({ category: cat, value: data.series[0]?.values[i] ?? 0 }));
    return (
      <ResponsiveContainer><PieChart>
        <Pie data={pieRows} dataKey="value" nameKey="category" outerRadius="80%" label>
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
  return (
    <ResponsiveContainer><BarChart data={rows}>
      <CartesianGrid stroke="var(--border)" /><XAxis dataKey="category" stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" /><Tooltip />
      {multi && <Legend />}
      {data.series.map((s, i) => <Bar key={s.name} dataKey={s.name} fill={COLORS[i % COLORS.length]} />)}
    </BarChart></ResponsiveContainer>
  );
}
