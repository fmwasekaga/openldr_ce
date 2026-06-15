import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { fetchReports, type ReportSummary } from '../api';
import { useReport } from '../reports/useReport';
import { ReportView } from '../reports/ReportView';

function ReportCard({ summary }: { summary: ReportSummary }) {
  const { loading, error, result } = useReport(summary.id);
  return (
    <Link
      to={`/reports/${summary.id}`}
      className="block rounded-lg border border-border p-4 text-inherit no-underline transition-colors hover:border-ring"
    >
      <h3>{summary.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{summary.description}</p>
      <div className="mt-3">
        {loading ? <span className="text-sm text-muted-foreground">Loading…</span>
          : error ? <span className="text-sm text-destructive">{error}</span>
          : result ? <ReportView result={result} /> : null}
      </div>
    </Link>
  );
}

export function Reports() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => { fetchReports().then(setReports).catch((e) => setError(String(e))); }, []);
  return (
    <AppShell title="Reports">
      <div className="ui-scope">
        {error && <div className="mb-4 text-sm text-destructive">{error}</div>}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
          {reports.map((r) => <ReportCard key={r.id} summary={r} />)}
        </div>
      </div>
    </AppShell>
  );
}
