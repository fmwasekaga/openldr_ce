import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useReport } from '../reports/useReport';
import { ReportView } from '../reports/ReportView';
import { csvUrl } from '../api';

export function ReportDetail() {
  const { id = '' } = useParams();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [facility, setFacility] = useState('');
  const params: Record<string, string> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  if (facility) params.facility = facility;
  const { loading, error, result } = useReport(id, params);
  return (
    <AppShell title={result ? `Report · ${id}` : 'Report'}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="btn-secondary" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="from" />
        <input className="btn-secondary" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="to" />
        <input className="btn-secondary" placeholder="Facility id" value={facility} onChange={(e) => setFacility(e.target.value)} aria-label="facility" />
        <a className="btn-primary" href={csvUrl(id, params)}>Export CSV</a>
      </div>
      {loading ? <div className="card">Loading…</div>
        : error ? <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>
        : result ? <ReportView result={result} /> : null}
    </AppShell>
  );
}
