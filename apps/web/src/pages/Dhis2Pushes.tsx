import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listDhis2Pushes, type Dhis2Push } from '@/api';

export function Dhis2Pushes() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Dhis2Push[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void (async () => { try { setRows(await listDhis2Pushes(100)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } })(); }, []);

  return (
    <AppShell title="DHIS2 push history">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-pushes-page">
        {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t('dhis2.ops.when')}</TableHead><TableHead>{t('dhis2.ops.action')}</TableHead>
            <TableHead>{t('dhis2.ops.mapping')}</TableHead><TableHead>{t('dhis2.ops.period')}</TableHead>
            <TableHead>{t('dhis2.ops.status')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t('dhis2.ops.noPushes')}</TableCell></TableRow>
            ) : rows.map((p) => {
              const md = (p.metadata ?? {}) as { period?: string; status?: string };
              return (
                <TableRow key={p.id}>
                  <TableCell className="text-xs text-muted-foreground">{new Date(p.occurredAt).toLocaleString()}</TableCell>
                  <TableCell>{p.action}</TableCell>
                  <TableCell>{p.entityId}</TableCell>
                  <TableCell>{md.period ?? '—'}</TableCell>
                  <TableCell>{md.status ?? '—'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </AppShell>
  );
}
