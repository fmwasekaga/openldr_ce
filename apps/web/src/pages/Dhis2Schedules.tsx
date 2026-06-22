import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listDhis2Schedules, listDhis2Mappings, createDhis2Schedule, setDhis2ScheduleEnabled, deleteDhis2Schedule, type Dhis2Schedule, type Dhis2MappingSummary } from '@/api';

export function Dhis2Schedules() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Dhis2Schedule[]>([]);
  const [mappings, setMappings] = useState<Dhis2MappingSummary[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Dhis2Schedule | null>(null);
  const [newMapping, setNewMapping] = useState('');
  const [newPeriod, setNewPeriod] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');
  const [newEventDriven, setNewEventDriven] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const [s, m] = await Promise.all([listDhis2Schedules(), listDhis2Mappings()]); setRows(s); setMappings(m); }
    catch (e) { setToast(t('dhis2.ops.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 5000); return () => clearTimeout(id); }, [toast]);

  const onToggle = useCallback(async (s: Dhis2Schedule) => {
    try { await setDhis2ScheduleEnabled(s.id, !s.enabled); await load(); }
    catch (e) { setToast(t('dhis2.ops.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [load, t]);
  const onCreate = useCallback(async () => {
    if (!newMapping) return;
    try { await createDhis2Schedule({ mappingId: newMapping, periodType: newPeriod, eventDriven: newEventDriven }); setNewMapping(''); await load(); }
    catch (e) { setToast(t('dhis2.ops.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [newMapping, newPeriod, newEventDriven, load, t]);
  const doDelete = useCallback(async () => {
    if (!pendingDelete) return; const s = pendingDelete; setPendingDelete(null);
    try { await deleteDhis2Schedule(s.id); await load(); }
    catch (e) { setToast(t('dhis2.ops.errorToast', { error: e instanceof Error ? e.message : String(e) })); }
  }, [pendingDelete, load, t]);

  return (
    <AppShell title="DHIS2 schedules">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-schedules-page">
        <p className="text-xs text-muted-foreground">{t('dhis2.ops.syncNote')}</p>
        {toast ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{toast}</div> : null}

        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{t('dhis2.ops.mapping')}</span>
            <Select value={newMapping} onValueChange={setNewMapping}>
              <SelectTrigger data-testid="new-mapping" className="w-44"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {mappings.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{t('dhis2.ops.periodType')}</span>
            <Select value={newPeriod} onValueChange={(v) => setNewPeriod(v as 'monthly' | 'quarterly' | 'yearly')}>
              <SelectTrigger data-testid="new-period" className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">monthly</SelectItem>
                <SelectItem value="quarterly">quarterly</SelectItem>
                <SelectItem value="yearly">yearly</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newEventDriven} onChange={(e) => setNewEventDriven(e.target.checked)} />{t('dhis2.ops.eventDriven')}</label>
          <Button data-testid="create-schedule" disabled={!newMapping} onClick={() => void onCreate()}>{t('dhis2.ops.create')}</Button>
        </div>

        <Table>
          <TableHeader><TableRow>
            <TableHead>{t('dhis2.ops.mapping')}</TableHead><TableHead>{t('dhis2.ops.periodType')}</TableHead>
            <TableHead>{t('dhis2.ops.eventDriven')}</TableHead><TableHead>{t('dhis2.ops.enabled')}</TableHead>
            <TableHead>{t('dhis2.ops.nextDue')}</TableHead><TableHead className="w-40" />
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t('dhis2.ops.noSchedules')}</TableCell></TableRow>
            ) : rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.mappingName} <Badge variant="outline" className="ml-1 text-[10px]">{s.mode}</Badge></TableCell>
                <TableCell>{s.periodType}</TableCell>
                <TableCell>{s.eventDriven ? '✓' : '—'}</TableCell>
                <TableCell>{s.enabled ? <Badge className="border-transparent bg-emerald-500/15 text-emerald-700">on</Badge> : <Badge variant="outline">off</Badge>}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.nextDueAt ? new Date(s.nextDueAt).toLocaleString() : '—'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" data-testid={`toggle-${s.id}`} onClick={() => void onToggle(s)}>{s.enabled ? 'Disable' : 'Enable'}</Button>
                    <Button variant="ghost" size="sm" className="text-destructive" data-testid={`del-${s.id}`} onClick={() => setPendingDelete(s)}>{t('dhis2.ops.delete')}</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <ConfirmDialog open={pendingDelete !== null} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
          title={t('dhis2.ops.deleteScheduleTitle')} description={t('dhis2.ops.deleteScheduleDesc')}
          confirmLabel={t('dhis2.ops.delete')} destructive onConfirm={() => { void doDelete(); }} />
      </div>
    </AppShell>
  );
}
