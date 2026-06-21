import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fetchReports, getDhis2Metadata, getReportColumns, getDhis2Mapping, saveDhis2Mapping, validateDhis2Mapping,
  type ReportSummary, type Dhis2MetadataLists, type ReportColumn2, type AggregateMappingDef, type AggregateColumnMapping,
} from '@/api';

type Row = { column: string; dataElement: string; categoryOptionCombo: string };

export function Dhis2MappingEditor() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = id === undefined;

  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [meta, setMeta] = useState<Dhis2MetadataLists | null>(null);
  const [columns, setColumns] = useState<ReportColumn2[]>([]);
  const [tracker, setTracker] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const [mappingId, setMappingId] = useState<string>('');
  const [name, setName] = useState('');
  const [reportId, setReportId] = useState('');
  const [orgUnitColumn, setOrgUnitColumn] = useState('');
  const [periodColumn, setPeriodColumn] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initial load: reports + cached metadata + (edit) the mapping.
  useEffect(() => {
    void (async () => {
      try {
        const [reps, m] = await Promise.all([fetchReports(), getDhis2Metadata()]);
        setReports(reps); setMeta(m);
        if (isNew) { setMappingId(`mapping-${crypto.randomUUID()}`); return; }
        try {
          const rec = await getDhis2Mapping(id!);
          const def = rec.definition as Record<string, unknown> & { kind?: string; source?: { reportId?: string }; orgUnitColumn?: string; periodColumn?: string; columns?: AggregateColumnMapping[] };
          if (def.kind === 'tracker') { setTracker(true); return; }
          setMappingId(rec.id);
          setName(rec.name);
          setReportId(def.source?.reportId ?? '');
          setOrgUnitColumn(def.orgUnitColumn ?? '');
          setPeriodColumn(def.periodColumn ?? '');
          setRows((def.columns ?? []).map((c) => ({ column: c.column, dataElement: c.dataElement, categoryOptionCombo: c.categoryOptionCombo ?? '' })));
          if (def.source?.reportId) setColumns(await getReportColumns(def.source.reportId).catch(() => []));
        } catch (e) {
          // Distinguish a genuine 404 (mapping gone) from an unexpected failure.
          if (e instanceof Error && e.message.includes('404')) setNotFound(true);
          else setError(e instanceof Error ? e.message : String(e));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onReport = useCallback(async (rid: string) => {
    setReportId(rid); setProblems(null);
    if (!rid) { setColumns([]); return; }
    try { setColumns(await getReportColumns(rid)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setColumns([]); }
  }, []);

  const def = useCallback((): AggregateMappingDef => ({
    kind: 'aggregate',
    id: mappingId,
    name,
    source: { kind: 'report', reportId },
    orgUnitColumn,
    ...(periodColumn ? { periodColumn } : {}),
    columns: rows
      .filter((r) => r.column && r.dataElement)
      .map((r): AggregateColumnMapping => ({ column: r.column, dataElement: r.dataElement, ...(r.categoryOptionCombo ? { categoryOptionCombo: r.categoryOptionCombo } : {}) })),
  }), [mappingId, name, reportId, orgUnitColumn, periodColumn, rows]);

  const onValidate = useCallback(async () => {
    try { setProblems(await validateDhis2Mapping(def())); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [def]);

  const onSave = useCallback(async () => {
    try { await saveDhis2Mapping(mappingId, { name, definition: def() }); navigate('/dhis2/mappings'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [mappingId, name, def, navigate]);

  if (loading) {
    return <AppShell title="DHIS2 mapping"><div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div></AppShell>;
  }
  if (tracker) {
    return <AppShell title="DHIS2 mapping"><div className="p-6 text-sm text-muted-foreground">{t('dhis2.mappings.editor.trackerNotice')}</div></AppShell>;
  }
  if (notFound) {
    return <AppShell title="DHIS2 mapping"><div className="p-6 text-sm text-muted-foreground">{t('dhis2.mappings.editor.notFound')}</div></AppShell>;
  }

  const metaEmpty = (meta?.dataElements.length ?? 0) === 0;

  return (
    <AppShell title={isNew ? t('dhis2.mappings.editor.newTitle') : t('dhis2.mappings.editor.editTitle')}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-testid="dhis2-mapping-editor">
        {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
        {metaEmpty ? <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">{t('dhis2.mappings.editor.noMetadata')}</div> : null}

        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{t('dhis2.mappings.editor.mappingName')}</span>
          <Input data-testid="mapping-name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{t('dhis2.mappings.editor.sourceReport')}</span>
          <select data-testid="report-select" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={reportId} onChange={(e) => void onReport(e.target.value)}>
            <option value="">{t('dhis2.mappings.editor.pickReport')}</option>
            {reports.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{t('dhis2.mappings.editor.orgUnitColumn')}</span>
            <select data-testid="orgunit-column-select" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={orgUnitColumn} onChange={(e) => setOrgUnitColumn(e.target.value)}>
              <option value="">{t('dhis2.mappings.editor.pickColumn')}</option>
              {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{t('dhis2.mappings.editor.periodColumn')}</span>
            <select data-testid="period-column-select" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={periodColumn} onChange={(e) => setPeriodColumn(e.target.value)}>
              <option value="">{t('dhis2.mappings.editor.pickColumn')}</option>
              {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('dhis2.mappings.editor.columns')}</span>
            <Button variant="outline" size="sm" data-testid="add-column" onClick={() => setRows((r) => [...r, { column: '', dataElement: '', categoryOptionCombo: '' }])}>{t('dhis2.mappings.editor.addColumn')}</Button>
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2" data-testid={`column-row-${i}`}>
              <select data-testid={`column-key-${i}`} className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={row.column} onChange={(e) => setRows((r) => r.map((x, j) => j === i ? { ...x, column: e.target.value } : x))}>
                <option value="">{t('dhis2.mappings.editor.reportColumn')}</option>
                {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <select data-testid={`column-de-${i}`} className="h-9 rounded-md border border-input bg-background px-2 text-sm" disabled={metaEmpty} value={row.dataElement} onChange={(e) => setRows((r) => r.map((x, j) => j === i ? { ...x, dataElement: e.target.value } : x))}>
                <option value="">{t('dhis2.mappings.editor.dataElement')}</option>
                {(meta?.dataElements ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select data-testid={`column-coc-${i}`} className="h-9 rounded-md border border-input bg-background px-2 text-sm" disabled={metaEmpty} value={row.categoryOptionCombo} onChange={(e) => setRows((r) => r.map((x, j) => j === i ? { ...x, categoryOptionCombo: e.target.value } : x))}>
                <option value="">{t('dhis2.mappings.editor.coc')}</option>
                {(meta?.categoryOptionCombos ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Button variant="ghost" size="sm" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>{t('dhis2.mappings.editor.remove')}</Button>
            </div>
          ))}
        </div>

        {problems !== null ? (
          <div className="rounded-md border border-border px-3 py-2 text-sm" data-testid="validate-problems">
            {problems.length === 0 ? t('dhis2.mappings.editor.noProblems') : <ul className="list-disc pl-5 text-destructive">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button variant="outline" data-testid="validate-mapping" onClick={() => void onValidate()}>{t('dhis2.mappings.editor.validate')}</Button>
          <Button data-testid="save-mapping" onClick={() => void onSave()}>{t('dhis2.mappings.editor.save')}</Button>
          <Button variant="ghost" onClick={() => navigate('/dhis2/mappings')}>{t('dhis2.mappings.editor.cancel')}</Button>
        </div>
      </div>
    </AppShell>
  );
}
