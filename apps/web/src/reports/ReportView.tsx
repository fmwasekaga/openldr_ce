import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { ReportResult } from '../api';

const PIE_COLORS = ['#4682B4', '#5A9BD6', '#22c55e', '#f59e0b', '#ef4444', '#898989'];

export function ReportView({ result }: { result: ReportResult }) {
  const { columns, rows } = result;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ height: 320 }}>
        <Chart result={result} />
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table>
          <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} style={{ color: 'var(--text-muted)' }}>No data for the selected filters.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i}>{columns.map((c) => <td key={c.key}>{format(r[c.key], c.kind)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{result.meta.rowCount} rows · generated {result.meta.generatedAt}</div>
    </div>
  );
}

function format(v: unknown, kind: string): string {
  if (v === null || v === undefined) return '';
  if (kind === 'percent') return `${v}%`;
  return String(v);
}

function Chart({ result }: { result: ReportResult }) {
  const { chart, rows } = result;
  if (chart.type === 'stat') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', gap: 8 }}>
        <div style={{ fontSize: 48, fontWeight: 600, color: 'var(--brand)' }}>{chart.value}</div>
        <div style={{ color: 'var(--text-muted)' }}>{chart.label}</div>
      </div>
    );
  }
  if (chart.type === 'pie') {
    return (
      <ResponsiveContainer>
        <PieChart>
          <Pie data={rows} dataKey={chart.value!} nameKey={chart.label!} outerRadius={110} label>
            {rows.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip /><Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === 'line') {
    return (
      <ResponsiveContainer>
        <LineChart data={rows}>
          <CartesianGrid stroke="var(--border)" /><XAxis dataKey={chart.x!} stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" />
          <Tooltip /><Line type="monotone" dataKey={chart.y!} stroke="var(--brand)" />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer>
      <BarChart data={rows}>
        <CartesianGrid stroke="var(--border)" /><XAxis dataKey={chart.x!} stroke="var(--text-muted)" /><YAxis stroke="var(--text-muted)" />
        <Tooltip /><Bar dataKey={chart.y!} fill="var(--brand)" />
      </BarChart>
    </ResponsiveContainer>
  );
}
