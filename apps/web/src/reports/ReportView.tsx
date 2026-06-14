import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { ReportResult } from '../api';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const PIE_COLORS = ['#4682B4', '#5A9BD6', '#22c55e', '#f59e0b', '#ef4444', '#898989'];

export function ReportView({ result }: { result: ReportResult }) {
  const { columns, rows } = result;
  return (
    <div className="ui-scope flex flex-col gap-4">
      <div className="h-80 rounded-lg border border-border p-3">
        <Chart result={result} />
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>{columns.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-muted-foreground">No data for the selected filters.</TableCell>
              </TableRow>
            ) : rows.map((r, i) => (
              <TableRow key={i}>{columns.map((c) => <TableCell key={c.key}>{format(r[c.key], c.kind)}</TableCell>)}</TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="text-xs text-muted-foreground">{result.meta.rowCount} rows · generated {result.meta.generatedAt}</div>
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
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="text-5xl font-semibold text-primary">{chart.value}</div>
        <div className="text-muted-foreground">{chart.label}</div>
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
