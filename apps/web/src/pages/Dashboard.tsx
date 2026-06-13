import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { fetchReports, type ReportSummary } from '../api';
import { useReport } from '../reports/useReport';
import { ReportView } from '../reports/ReportView';

function ReportCard({ summary }: { summary: ReportSummary }) {
  const { loading, error, result } = useReport(summary.id);
  return (
    <Link to={`/reports/${summary.id}`} className="card" style={{ display: 'block', color: 'inherit' }}>
      <h3>{summary.name}</h3>
      <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>{summary.description}</p>
      <div style={{ marginTop: 8 }}>
        {loading ? <span style={{ color: 'var(--text-muted)' }}>Loading…</span>
          : error ? <span style={{ color: 'var(--danger)' }}>{error}</span>
          : result ? <ReportView result={result} /> : null}
      </div>
    </Link>
  );
}

export function Dashboard() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => { fetchReports().then(setReports).catch((e) => setError(String(e))); }, []);
  return (
    <AppShell title="Dashboard">
      {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        {reports.map((r) => <ReportCard key={r.id} summary={r} />)}
      </div>
    </AppShell>
  );
}
