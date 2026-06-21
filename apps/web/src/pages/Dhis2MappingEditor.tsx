import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fetchReports, getDhis2Metadata, getReportColumns, getDhis2EventSources, getDhis2Mapping, saveDhis2Mapping, validateDhis2Mapping,
  type ReportSummary, type Dhis2MetadataLists, type ReportColumn2, type Dhis2EventSource,
  type AggregateMappingDef, type AggregateColumnMapping, type TrackerMappingDef, type MappingDef,
} from '@/api';

type Kind = 'aggregate' | 'tracker';
type AggRow = { column: string; dataElement: string; categoryOptionCombo: string };
type TrkRow = { column: string; dataElement: string };
const SELECT = 'h-9 rounded-md border border-input bg-background px-2 text-sm';

export function Dhis2MappingEditor() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = id === undefined;

  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [eventSources, setEventSources] = useState<Dhis2EventSource[]>([]);
  const [meta, setMeta] = useState<Dhis2MetadataLists | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const [kind, setKind] = useState<Kind>('aggregate');
  const [mappingId, setMappingId] = useState('');
  const [name, setName] = useState('');
  const [problems, setProblems] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Aggregate state
  const [reportId, setReportId] = useState('');
  const [reportColumns, setReportColumns] = useState<ReportColumn2[]>([]);
  const [aggOrgUnitColumn, setAggOrgUnitColumn] = useState('');
  const [periodColumn, setPeriodColumn] = useState('');
  const [aggRows, setAggRows] = useState<AggRow[]>([]);

  // Tracker state
  const [sourceId, setSourceId] = useState('');
  const [program, setProgram] = useState('');
  const [programStage, setProgramStage] = useState('');
  const [trkOrgUnitColumn, setTrkOrgUnitColumn] = useState('');
  const [eventDateColumn, setEventDateColumn] = useState('');
  const [idColumn, setIdColumn] = useState('');
  const [trkRows, setTrkRows] = useState<TrkRow[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [reps, srcs, m] = await Promise.all([fetchReports(), getDhis2EventSources(), getDhis2Metadata()]);
        setReports(reps); setEventSources(srcs); setMeta(m);
        if (isNew) { setMappingId(`mapping-${crypto.randomUUID()}`); return; }
        try {
          const rec = await getDhis2Mapping(id!);
          const d = rec.definition as Record<string, unknown> & {
            kind?: string; source?: { reportId?: string; sourceId?: string };
            orgUnitColumn?: string; periodColumn?: string; columns?: AggregateColumnMapping[];
            program?: string; programStage?: string; eventDateColumn?: string; idColumn?: string; dataValues?: TrkRow[];
          };
          setMappingId(rec.id); setName(rec.name);
          if (d.kind === 'tracker') {
            setKind('tracker');
            setSourceId(d.source?.sourceId ?? '');
            setProgram(d.program ?? '');
            setProgramStage(d.programStage ?? '');
            setTrkOrgUnitColumn(d.orgUnitColumn ?? '');
            setEventDateColumn(d.eventDateColumn ?? '');
            setIdColumn(d.idColumn ?? '');
            setTrkRows((d.dataValues ?? []).map((r) => ({ column: r.column, dataElement: r.dataElement })));
          } else {
            setKind('aggregate');
            setReportId(d.source?.reportId ?? '');
            setAggOrgUnitColumn(d.orgUnitColumn ?? '');
            setPeriodColumn(d.periodColumn ?? '');
            setAggRows((d.columns ?? []).map((c) => ({ column: c.column, dataElement: c.dataElement, categoryOptionCombo: c.categoryOptionCombo ?? '' })));
            if (d.source?.reportId) setReportColumns(await getReportColumns(d.source.reportId).catch(() => []));
          }
        } catch (e) {
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
    if (!rid) { setReportColumns([]); return; }
    try { setReportColumns(await getReportColumns(rid)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setReportColumns([]); }
  }, []);

  const srcColumns = useMemo(() => eventSources.find((s) => s.id === sourceId)?.columns ?? [], [eventSources, sourceId]);
  const stages = useMemo(() => (meta?.programStages ?? []).filter((s) => s.program === program), [meta, program]);
  const metaEmpty = (meta?.dataElements.length ?? 0) === 0;

  const def = useCallback((): MappingDef => {
    if (kind === 'tracker') {
      const d: TrackerMappingDef = {
        kind: 'tracker', id: mappingId, name,
        source: { kind: 'event-source', sourceId },
        program, programStage, orgUnitColumn: trkOrgUnitColumn, eventDateColumn, idColumn,
        dataValues: trkRows.filter((r) => r.column && r.dataElement).map((r) => ({ column: r.column, dataElement: r.dataElement })),
      };
      return d;
    }
    const d: AggregateMappingDef = {
      kind: 'aggregate', id: mappingId, name,
      source: { kind: 'report', reportId },
      orgUnitColumn: aggOrgUnitColumn,
      ...(periodColumn ? { periodColumn } : {}),
      columns: aggRows.filter((r) => r.column && r.dataElement).map((r): AggregateColumnMapping => ({ column: r.column, dataElement: r.dataElement, ...(r.categoryOptionCombo ? { categoryOptionCombo: r.categoryOptionCombo } : {}) })),
    };
    return d;
  }, [kind, mappingId, name, reportId, aggOrgUnitColumn, periodColumn, aggRows, sourceId, program, programStage, trkOrgUnitColumn, eventDateColumn, idColumn, trkRows]);

  const onValidate = useCallback(async () => {
    try { setProblems(await validateDhis2Mapping(def())); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [def]);
  const onSave = useCallback(async () => {
    try { await saveDhis2Mapping(mappingId, { name, definition: def() }); navigate('/dhis2/mappings'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [mappingId, name, def, navigate]);

  if (loading) return <AppShell title="DHIS2 mapping"><div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div></AppShell>;
  if (notFound) return <AppShell title="DHIS2 mapping"><div className="p-6 text-sm text-muted-foreground">{t('dhis2.mappings.editor.notFound')}</div></AppShell>;

  return (
    <AppShell title={isNew ? t('dhis2.mappings.editor.newTitle') : t('dhis2.mappings.editor.editTitle')}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" data-testid="dhis2-mapping-editor">
        {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
        {metaEmpty ? <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">{t('dhis2.mappings.editor.noMetadata')}</div> : null}

        {isNew ? (
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{t('dhis2.mappings.editor.kindLabel')}</span>
            <select data-testid="kind-select" className={SELECT} value={kind} onChange={(e) => {
              setKind(e.target.value as Kind); setProblems(null);
              // Reset both branches so switching mapping type starts fresh (def() is kind-gated, but stale values are surprising on toggle-back).
              setReportId(''); setReportColumns([]); setAggOrgUnitColumn(''); setPeriodColumn(''); setAggRows([]);
              setSourceId(''); setProgram(''); setProgramStage(''); setTrkOrgUnitColumn(''); setEventDateColumn(''); setIdColumn(''); setTrkRows([]);
            }}>
              <option value="aggregate">{t('dhis2.mappings.editor.kindAggregate')}</option>
              <option value="tracker">{t('dhis2.mappings.editor.kindTracker')}</option>
            </select>
          </label>
        ) : null}

        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{t('dhis2.mappings.editor.mappingName')}</span>
          <Input data-testid="mapping-name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        {kind === 'aggregate' ? (
          <>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">{t('dhis2.mappings.editor.sourceReport')}</span>
              <select data-testid="report-select" className={SELECT} value={reportId} onChange={(e) => void onReport(e.target.value)}>
                <option value="">{t('dhis2.mappings.editor.pickReport')}</option>
                {reports.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t('dhis2.mappings.editor.orgUnitColumn')}</span>
                <select data-testid="orgunit-column-select" className={SELECT} value={aggOrgUnitColumn} onChange={(e) => setAggOrgUnitColumn(e.target.value)}>
                  <option value="">{t('dhis2.mappings.editor.pickColumn')}</option>
                  {reportColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t('dhis2.mappings.editor.periodColumn')}</span>
                <select data-testid="period-column-select" className={SELECT} value={periodColumn} onChange={(e) => setPeriodColumn(e.target.value)}>
                  <option value="">{t('dhis2.mappings.editor.pickColumn')}</option>
                  {reportColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t('dhis2.mappings.editor.columns')}</span>
                <Button variant="outline" size="sm" data-testid="add-column" onClick={() => setAggRows((r) => [...r, { column: '', dataElement: '', categoryOptionCombo: '' }])}>{t('dhis2.mappings.editor.addColumn')}</Button>
              </div>
              {aggRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2" data-testid={`column-row-${i}`}>
                  <select data-testid={`column-key-${i}`} className={SELECT} value={row.column} onChange={(e) => setAggRows((r) => r.map((x, j) => j === i ? { ...x, column: e.target.value } : x))}>
                    <option value="">{t('dhis2.mappings.editor.reportColumn')}</option>
                    {reportColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <select data-testid={`column-de-${i}`} className={SELECT} disabled={metaEmpty} value={row.dataElement} onChange={(e) => setAggRows((r) => r.map((x, j) => j === i ? { ...x, dataElement: e.target.value } : x))}>
                    <option value="">{t('dhis2.mappings.editor.dataElement')}</option>
                    {(meta?.dataElements ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <select data-testid={`column-coc-${i}`} className={SELECT} disabled={metaEmpty} value={row.categoryOptionCombo} onChange={(e) => setAggRows((r) => r.map((x, j) => j === i ? { ...x, categoryOptionCombo: e.target.value } : x))}>
                    <option value="">{t('dhis2.mappings.editor.coc')}</option>
                    {(meta?.categoryOptionCombos ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <Button variant="ghost" size="sm" onClick={() => setAggRows((r) => r.filter((_, j) => j !== i))}>{t('dhis2.mappings.editor.remove')}</Button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">{t('dhis2.mappings.editor.tracker.sourceEventSource')}</span>
              <select data-testid="event-source-select" className={SELECT} value={sourceId} onChange={(e) => { setSourceId(e.target.value); setProblems(null); }}>
                <option value="">{t('dhis2.mappings.editor.tracker.pickEventSource')}</option>
                {eventSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t('dhis2.mappings.editor.tracker.program')}</span>
                <select data-testid="program-select" className={SELECT} disabled={metaEmpty} value={program} onChange={(e) => { setProgram(e.target.value); setProgramStage(''); }}>
                  <option value="">{t('dhis2.mappings.editor.tracker.pickProgram')}</option>
                  {(meta?.programs ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t('dhis2.mappings.editor.tracker.programStage')}</span>
                <select data-testid="program-stage-select" className={SELECT} disabled={metaEmpty || !program} value={programStage} onChange={(e) => setProgramStage(e.target.value)}>
                  <option value="">{t('dhis2.mappings.editor.tracker.pickStage')}</option>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t('dhis2.mappings.editor.tracker.orgUnitColumn')}</span>
                <select data-testid="tracker-orgunit-select" className={SELECT} value={trkOrgUnitColumn} onChange={(e) => setTrkOrgUnitColumn(e.target.value)}>
                  <option value="">{t('dhis2.mappings.editor.tracker.pickColumn')}</option>
                  {srcColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t('dhis2.mappings.editor.tracker.eventDateColumn')}</span>
                <select data-testid="tracker-eventdate-select" className={SELECT} value={eventDateColumn} onChange={(e) => setEventDateColumn(e.target.value)}>
                  <option value="">{t('dhis2.mappings.editor.tracker.pickColumn')}</option>
                  {srcColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t('dhis2.mappings.editor.tracker.idColumn')}</span>
                <select data-testid="tracker-id-select" className={SELECT} value={idColumn} onChange={(e) => setIdColumn(e.target.value)}>
                  <option value="">{t('dhis2.mappings.editor.tracker.pickColumn')}</option>
                  {srcColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t('dhis2.mappings.editor.tracker.dataValues')}</span>
                <Button variant="outline" size="sm" data-testid="add-datavalue" onClick={() => setTrkRows((r) => [...r, { column: '', dataElement: '' }])}>{t('dhis2.mappings.editor.tracker.addRow')}</Button>
              </div>
              {trkRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2" data-testid={`dv-row-${i}`}>
                  <select data-testid={`dv-col-${i}`} className={SELECT} value={row.column} onChange={(e) => setTrkRows((r) => r.map((x, j) => j === i ? { ...x, column: e.target.value } : x))}>
                    <option value="">{t('dhis2.mappings.editor.tracker.eventColumn')}</option>
                    {srcColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <select data-testid={`dv-de-${i}`} className={SELECT} disabled={metaEmpty} value={row.dataElement} onChange={(e) => setTrkRows((r) => r.map((x, j) => j === i ? { ...x, dataElement: e.target.value } : x))}>
                    <option value="">{t('dhis2.mappings.editor.tracker.dataElement')}</option>
                    {(meta?.dataElements ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <Button variant="ghost" size="sm" onClick={() => setTrkRows((r) => r.filter((_, j) => j !== i))}>{t('dhis2.mappings.editor.tracker.remove')}</Button>
                </div>
              ))}
            </div>
          </>
        )}

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
