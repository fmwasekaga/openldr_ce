import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useReport } from '../reports/useReport';
import { ReportView } from '../reports/ReportView';
import { csvUrl } from '../api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

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
      <div className="ui-scope">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input type="date" className="w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="from" />
          <Input type="date" className="w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="to" />
          <Input className="w-48" placeholder="Facility id" value={facility} onChange={(e) => setFacility(e.target.value)} aria-label="facility" />
          <Button asChild><a href={csvUrl(id, params)}>Export CSV</a></Button>
        </div>
        {loading ? <div className="text-sm text-muted-foreground">Loading…</div>
          : error ? <div className="text-sm text-destructive">{error}</div>
          : result ? <ReportView result={result} /> : null}
      </div>
    </AppShell>
  );
}
