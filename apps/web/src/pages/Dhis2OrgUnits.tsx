import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getOrgUnitMappings, setOrgUnitMapping, clearOrgUnitMapping, type Dhis2OrgUnitMappings } from '@/api';

export function Dhis2OrgUnits() {
  const { t } = useTranslation();
  const [data, setData] = useState<Dhis2OrgUnitMappings | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try { setData(await getOrgUnitMappings()); }
    catch (e) { setToast({ kind: 'err', text: t('dhis2.orgunits.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 5000); return () => clearTimeout(id); }, [toast]);

  const options = useMemo(() => (data?.orgUnits ?? []).map((o) => ({ value: o.id, label: o.name })), [data]);
  const catalogEmpty = (data?.orgUnits.length ?? 0) === 0;

  const onPick = useCallback(async (facilityId: string, orgUnitId: string) => {
    const ou = data?.orgUnits.find((o) => o.id === orgUnitId);
    try {
      await setOrgUnitMapping(facilityId, { orgUnitId, orgUnitName: ou?.name ?? null });
      setToast({ kind: 'ok', text: t('dhis2.orgunits.mappedToast', { facility: facilityId }) });
      await load();
    } catch (e) { setToast({ kind: 'err', text: t('dhis2.orgunits.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
  }, [data, load, t]);

  const onClear = useCallback(async (facilityId: string) => {
    try { await clearOrgUnitMapping(facilityId); setToast({ kind: 'ok', text: t('dhis2.orgunits.clearedToast', { facility: facilityId }) }); await load(); }
    catch (e) { setToast({ kind: 'err', text: t('dhis2.orgunits.errorToast', { error: e instanceof Error ? e.message : String(e) }) }); }
  }, [load, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" data-testid="dhis2-orgunits-page">
      <h1 className="text-lg font-semibold">{t('dhis2.orgunits.heading')}</h1>
        <div className="text-sm text-muted-foreground">
          {data?.metadataPulledAt
            ? t('dhis2.orgunits.pulledAt', { when: new Date(data.metadataPulledAt).toLocaleString() })
            : t('dhis2.orgunits.neverPulled')}
        </div>
        {toast ? (
          <div className={toast.kind === 'ok'
            ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700'
            : 'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive'}>{toast.text}</div>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('dhis2.orgunits.facility')}</TableHead>
              <TableHead>{t('dhis2.orgunits.orgUnit')}</TableHead>
              <TableHead className="w-72" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.facilities.length ?? 0) === 0 ? (
              <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">{t('dhis2.orgunits.noFacilities')}</TableCell></TableRow>
            ) : data!.facilities.map((f) => (
              <TableRow key={f.facilityId}>
                <TableCell>
                  <div className="font-medium">{f.facilityName}</div>
                  <div className="text-xs text-muted-foreground">{f.facilityId}</div>
                </TableCell>
                <TableCell>
                  {f.orgUnitId
                    ? <span>{f.orgUnitName ?? f.orgUnitId} <span className="text-xs text-muted-foreground">({f.orgUnitId})</span></span>
                    : <Badge variant="outline" className="text-muted-foreground">{t('dhis2.orgunits.unmapped')}</Badge>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2" data-testid={`orgunit-row-${f.facilityId}`}>
                    <div className="flex-1" data-testid={`orgunit-picker-${f.facilityId}`}>
                      <Combobox
                        options={options}
                        value={f.orgUnitId}
                        onChange={(v) => void onPick(f.facilityId, v)}
                        placeholder={t('dhis2.orgunits.pick')}
                        searchPlaceholder={t('dhis2.orgunits.search')}
                        disabled={catalogEmpty}
                      />
                    </div>
                    {f.orgUnitId ? (
                      <Button variant="ghost" size="sm" onClick={() => void onClear(f.facilityId)}>{t('dhis2.orgunits.clear')}</Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
    </div>
  );
}
