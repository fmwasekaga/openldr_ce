import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listDhis2Mappings, deleteDhis2Mapping, type Dhis2MappingSummary } from '@/api';

export function Dhis2Mappings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Dhis2MappingSummary[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Dhis2MappingSummary | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try { setRows(await listDhis2Mappings()); }
    catch (e) { setToast({ kind: 'err', text: t('dhis2.mappings.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 5000); return () => clearTimeout(id); }, [toast]);

  const doDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const m = pendingDelete; setPendingDelete(null);
    try { await deleteDhis2Mapping(m.id); setToast({ kind: 'ok', text: t('dhis2.mappings.deletedToast', { name: m.name }) }); await load(); }
    catch (e) { setToast({ kind: 'err', text: t('dhis2.mappings.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
  }, [pendingDelete, load, t]);

  return (
    <AppShell title="DHIS2 mappings">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-mappings-page">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">{t('dhis2.mappings.title')}</div>
          <Button onClick={() => navigate('/dhis2/mappings/new')} data-testid="new-mapping">{t('dhis2.mappings.newMapping')}</Button>
        </div>
        {toast ? (
          <div className={toast.kind === 'ok'
            ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700'
            : 'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive'}>{toast.text}</div>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('dhis2.mappings.name')}</TableHead>
              <TableHead className="w-32">{t('dhis2.mappings.kind')}</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">{t('dhis2.mappings.none')}</TableCell></TableRow>
            ) : rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{m.name}</TableCell>
                <TableCell><Badge variant="outline">{m.kind ?? 'aggregate'}</Badge></TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Link to={`/dhis2/mappings/${m.id}`} className="text-primary hover:underline" data-testid={`edit-${m.id}`}>{t('dhis2.mappings.edit')}</Link>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setPendingDelete(m)} data-testid={`delete-${m.id}`}>{t('dhis2.mappings.delete')}</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
          title={t('dhis2.mappings.deleteTitle', { name: pendingDelete?.name ?? '' })}
          description={t('dhis2.mappings.deleteDescription')}
          confirmLabel={t('dhis2.mappings.delete')}
          destructive
          onConfirm={() => { void doDelete(); }}
        />
      </div>
    </AppShell>
  );
}
