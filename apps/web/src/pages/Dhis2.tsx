import { useCallback, useEffect, useState } from 'react';
import { Network } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDhis2Status, pullDhis2Metadata, type Dhis2Status, type Dhis2MetadataCounts } from '@/api';

export function Dhis2() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Dhis2Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Dhis2MetadataCounts | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setStatus(await getDhis2Status()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const doPull = useCallback(async () => {
    setPulling(true); setPullError(null);
    try { setMeta(await pullDhis2Metadata()); }
    catch (e) { setPullError(e instanceof Error ? e.message : String(e)); }
    finally { setPulling(false); }
  }, []);

  const configured = status?.configured ?? false;

  return (
    <AppShell title="DHIS2">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-testid="dhis2-page">
        {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

        {/* Connection */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Network className="h-4 w-4" /><CardTitle>{t('dhis2.connection')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={configured ? 'default' : 'outline'}>{configured ? t('dhis2.configured') : t('dhis2.notConfigured')}</Badge>
              {configured && <Badge variant="outline">{status?.syncEnabled ? t('dhis2.syncEnabled') : t('dhis2.syncDisabled')}</Badge>}
            </div>
            {configured ? (
              <>
                <div><span className="text-muted-foreground">{t('dhis2.host')}: </span>{status?.host ?? '-'}</div>
                <div>
                  <span className="text-muted-foreground">{t('dhis2.reachability')}: </span>
                  {status?.reachable
                    ? `${t(`dhis2.${status.reachable.status}`)} (${status.reachable.latencyMs}ms)`
                    : '-'}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">{t('dhis2.notConfiguredHelp')}</p>
            )}
          </CardContent>
        </Card>

        {/* Metadata */}
        <Card>
          <CardHeader><CardTitle>{t('dhis2.metadata')}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Button onClick={() => void doPull()} disabled={!configured || pulling} data-testid="dhis2-pull-metadata">
              {pulling ? t('dhis2.pulling') : t('dhis2.pullMetadata')}
            </Button>
            {pullError ? <p className="text-destructive">{pullError}</p> : null}
            {meta ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                {([
                  ['dataElements', meta.dataElements], ['orgUnits', meta.orgUnits],
                  ['categoryOptionCombos', meta.categoryOptionCombos], ['programs', meta.programs],
                  ['programStages', meta.programStages],
                ] as const).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t(`dhis2.${k}`)}</dt><dd className="font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </CardContent>
        </Card>

        {/* Overview */}
        {configured && status?.counts ? (
          <Card>
            <CardHeader><CardTitle>{t('dhis2.overview')}</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-6">
                <div><span className="text-muted-foreground">{t('dhis2.mappings')}: </span>{status.counts.mappings}</div>
                <div>
                  <span className="text-muted-foreground">{t('dhis2.orgUnitMappings')}: </span>{status.counts.orgUnitMappings}
                  {' '}<Link to="/dhis2/orgunits" className="text-primary hover:underline" data-testid="manage-orgunits">{t('dhis2.orgunits.manage')}</Link>
                </div>
                <div><span className="text-muted-foreground">{t('dhis2.schedules')}: </span>{status.counts.schedules}</div>
              </div>
              <div>
                <div className="mb-1 font-medium">{t('dhis2.recentPushes')}</div>
                {status.recentPushes.length === 0 ? (
                  <p className="text-muted-foreground">{t('dhis2.noPushes')}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('dhis2.when')}</TableHead><TableHead>{t('dhis2.action')}</TableHead><TableHead>{t('dhis2.mapping')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {status.recentPushes.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-xs text-muted-foreground">{new Date(p.occurredAt).toLocaleString()}</TableCell>
                          <TableCell>{p.action}</TableCell><TableCell>{p.entityId}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
