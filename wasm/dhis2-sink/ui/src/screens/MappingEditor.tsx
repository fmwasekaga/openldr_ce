import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { getOpenldr } from '../sdk';
import { Picker } from '../components/Picker';

type Kind = 'aggregate' | 'tracker';
type AggRow = { column: string; dataElement: string; categoryOptionCombo: string };
type TrkRow = { column: string; dataElement: string };

/** A report summary from `reports.list()`. */
interface ReportSummary {
  id: string;
  name: string;
}

/** A report column from `reports.columns()`. */
interface ReportColumn {
  key: string;
  label: string;
}

/** An event source from `reports.eventSources()` with its columns. */
interface EventSource {
  id: string;
  name: string;
  columns?: ReportColumn[];
}

/** A connector from `connectors.list()`. */
interface Connector {
  id: string;
  name: string;
  enabled?: boolean;
}

/** Shapes inside the cached DHIS2 metadata catalog. */
interface MetaItem {
  id: string;
  name: string;
}
interface ProgramStage {
  id: string;
  name: string;
  program: string;
}
interface MetadataLists {
  dataElements: MetaItem[];
  categoryOptionCombos: MetaItem[];
  programs: MetaItem[];
  programStages: ProgramStage[];
  orgUnits?: MetaItem[];
}

/** The aggregate column mapping the def() emits. */
interface AggregateColumnMapping {
  column: string;
  dataElement: string;
  categoryOptionCombo?: string;
}

/** A saved mapping doc as stored in the `mappings` collection. */
interface MappingDoc {
  id: string;
  name: string;
  definition?: Record<string, unknown> & {
    kind?: string;
    source?: { reportId?: string; sourceId?: string };
    orgUnitColumn?: string;
    periodColumn?: string;
    columns?: AggregateColumnMapping[];
    program?: string;
    programStage?: string;
    eventDateColumn?: string;
    idColumn?: string;
    dataValues?: TrkRow[];
    connectorId?: string;
  };
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

type Phase =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'not-found' }
  | { phase: 'error'; message: string };

/**
 * The mapping editor — the plugin webview port of the host's Dhis2MappingEditor.
 * Create or edit an aggregate OR tracker mapping over the plugin SDK: cascading
 * pickers (report→columns, program→stage), dynamic rows, validate, and save.
 *
 * `mappingId` undefined = a new mapping; `onDone()` returns to the list (Task 12
 * wires routing — this replaces the host's useParams/useNavigate).
 */
export function MappingEditor({ mappingId: editId, onDone }: { mappingId?: string; onDone: () => void }) {
  const isNew = editId === undefined;

  const [phase, setPhase] = useState<Phase>({ phase: 'loading' });
  const [error, setError] = useState<string | null>(null);

  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [eventSources, setEventSources] = useState<EventSource[]>([]);
  const [meta, setMeta] = useState<MetadataLists | null>(null);
  const [connectors, setConnectors] = useState<Connector[]>([]);

  const [kind, setKind] = useState<Kind>('aggregate');
  const [mappingId, setMappingId] = useState('');
  const [name, setName] = useState('');
  const [connectorId, setConnectorId] = useState('');
  const [problems, setProblems] = useState<string[] | null>(null);

  // Aggregate state
  const [reportId, setReportId] = useState('');
  const [reportColumns, setReportColumns] = useState<ReportColumn[]>([]);
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
    let alive = true;
    (async () => {
      try {
        const o = getOpenldr();
        await o.ready;
        const [reps, srcs, cached, conns] = await Promise.all([
          o.reports.list(),
          o.reports.eventSources(),
          o.storage.get('metadataCache', 'latest'),
          o.connectors.list(),
        ]);
        if (!alive) return;
        setReports(asArray<ReportSummary>(reps));
        setEventSources(asArray<EventSource>(srcs));
        const metaCache = cached as { metadata?: Partial<MetadataLists> } | null;
        const m = metaCache?.metadata;
        setMeta({
          dataElements: asArray<MetaItem>(m?.dataElements),
          categoryOptionCombos: asArray<MetaItem>(m?.categoryOptionCombos),
          programs: asArray<MetaItem>(m?.programs),
          programStages: asArray<ProgramStage>(m?.programStages),
          orgUnits: asArray<MetaItem>(m?.orgUnits),
        });
        setConnectors(asArray<Connector>(conns));

        if (isNew) {
          setMappingId(`mapping-${crypto.randomUUID()}`);
          if (alive) setPhase({ phase: 'ready' });
          return;
        }

        const rec = (await o.storage.get('mappings', editId!)) as MappingDoc | null;
        if (!rec) {
          if (alive) setPhase({ phase: 'not-found' });
          return;
        }
        const d = rec.definition ?? {};
        if (!alive) return;
        setMappingId(rec.id);
        setName(rec.name);
        setConnectorId(d.connectorId ?? '');
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
          if (d.source?.reportId) {
            const cols = await o.reports.columns(d.source.reportId).catch(() => []);
            if (alive) setReportColumns(asArray<ReportColumn>(cols));
          }
        }
        if (alive) setPhase({ phase: 'ready' });
      } catch (e) {
        if (alive) setPhase({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        document.body.setAttribute('data-openldr-ready', '1');
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const onReport = useCallback(async (rid: string) => {
    setReportId(rid);
    setProblems(null);
    if (!rid) {
      setReportColumns([]);
      return;
    }
    try {
      const cols = await getOpenldr().reports.columns(rid);
      setReportColumns(asArray<ReportColumn>(cols));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setReportColumns([]);
    }
  }, []);

  const srcColumns = useMemo(
    () => eventSources.find((s) => s.id === sourceId)?.columns ?? [],
    [eventSources, sourceId],
  );
  const stages = useMemo(
    () => (meta?.programStages ?? []).filter((s) => s.program === program),
    [meta, program],
  );
  const enabledConnectors = useMemo(() => connectors.filter((c) => c.enabled), [connectors]);
  const metaEmpty = (meta?.dataElements.length ?? 0) === 0;

  const def = useCallback((): Record<string, unknown> => {
    if (kind === 'tracker') {
      return {
        kind: 'tracker',
        id: mappingId,
        name,
        ...(connectorId ? { connectorId } : {}),
        source: { kind: 'event-source', sourceId },
        program,
        programStage,
        orgUnitColumn: trkOrgUnitColumn,
        eventDateColumn,
        idColumn,
        dataValues: trkRows
          .filter((r) => r.column && r.dataElement)
          .map((r) => ({ column: r.column, dataElement: r.dataElement })),
      };
    }
    return {
      kind: 'aggregate',
      id: mappingId,
      name,
      ...(connectorId ? { connectorId } : {}),
      source: { kind: 'report', reportId },
      orgUnitColumn: aggOrgUnitColumn,
      ...(periodColumn ? { periodColumn } : {}),
      columns: aggRows
        .filter((r) => r.column && r.dataElement)
        .map((r): AggregateColumnMapping => ({
          column: r.column,
          dataElement: r.dataElement,
          ...(r.categoryOptionCombo ? { categoryOptionCombo: r.categoryOptionCombo } : {}),
        })),
    };
  }, [kind, mappingId, name, connectorId, reportId, aggOrgUnitColumn, periodColumn, aggRows, sourceId, program, programStage, trkOrgUnitColumn, eventDateColumn, idColumn, trkRows]);

  const onValidate = useCallback(async () => {
    // The host op pulls the connector's metadata to validate, so a connector is
    // required. Without one we cannot validate — guard rather than call with ''.
    if (!connectorId) return;
    try {
      const result = await getOpenldr().connectors.validate({ connectorId, mapping: def() });
      setProblems(asArray<string>(result));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [connectorId, def]);

  const onSave = useCallback(async () => {
    try {
      await getOpenldr().storage.put('mappings', mappingId, { id: mappingId, name, definition: def() });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [mappingId, name, def, onDone]);

  function onKindChange(v: Kind) {
    setKind(v);
    setProblems(null);
    // Reset both branches so switching mapping type starts fresh (def() is
    // kind-gated, but stale values are surprising on toggle-back).
    setReportId('');
    setReportColumns([]);
    setAggOrgUnitColumn('');
    setPeriodColumn('');
    setAggRows([]);
    setSourceId('');
    setProgram('');
    setProgramStage('');
    setTrkOrgUnitColumn('');
    setEventDateColumn('');
    setIdColumn('');
    setTrkRows([]);
  }

  if (phase.phase === 'loading') return <div class="dhis2"><p class="status muted">Loading…</p></div>;
  if (phase.phase === 'not-found') return <div class="dhis2"><p class="muted">That mapping no longer exists.</p></div>;
  if (phase.phase === 'error') return <div class="dhis2"><div class="error" role="alert">{phase.message}</div></div>;

  const colOptions = reportColumns.map((c) => ({ value: c.key, label: c.label }));
  const deOptions = (meta?.dataElements ?? []).map((d) => ({ value: d.id, label: d.name }));
  const cocOptions = (meta?.categoryOptionCombos ?? []).map((c) => ({ value: c.id, label: c.name }));
  const srcColOptions = srcColumns.map((c) => ({ value: c.key, label: c.label }));

  return (
    <div class="dhis2 mapping-editor" data-testid="dhis2-mapping-editor">
      <h1>{isNew ? 'New mapping' : 'Edit mapping'}</h1>

      {error && <div class="error" role="alert">{error}</div>}
      {metaEmpty && (
        <div class="warn" role="alert">
          No DHIS2 metadata cached yet. Pull metadata before you can pick data elements.
        </div>
      )}

      {isNew && (
        <label class="me-field">
          <span class="muted">Mapping kind</span>
          <div class="me-kind">
            <Picker
              testId="kind-select"
              value={kind}
              onChange={(v) => onKindChange(v as Kind)}
              options={[
                { value: 'aggregate', label: 'Aggregate' },
                { value: 'tracker', label: 'Tracker' },
              ]}
            />
          </div>
        </label>
      )}

      <label class="me-field">
        <span class="muted">Name</span>
        <input
          class="me-input"
          data-testid="mapping-name"
          value={name}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
      </label>

      <label class="me-field">
        <span class="muted">Connector</span>
        <Picker
          testId="connector-select"
          value={connectorId}
          onChange={setConnectorId}
          placeholder="Pick a connector"
          searchPlaceholder="Search connectors…"
          options={enabledConnectors.map((c) => ({ value: c.id, label: c.name }))}
        />
        {enabledConnectors.length === 0 && (
          <span class="me-hint">No enabled connectors. Add one in Connectors first.</span>
        )}
      </label>

      {kind === 'aggregate' ? (
        <>
          <label class="me-field">
            <span class="muted">Source report</span>
            <Picker
              testId="report-select"
              value={reportId}
              onChange={(v) => void onReport(v)}
              placeholder="Pick a report"
              searchPlaceholder="Search reports…"
              options={reports.map((r) => ({ value: r.id, label: r.name }))}
            />
          </label>
          <div class="me-grid me-grid-2">
            <label class="me-field">
              <span class="muted">Org-unit column</span>
              <Picker
                testId="orgunit-column-select"
                value={aggOrgUnitColumn}
                onChange={setAggOrgUnitColumn}
                placeholder="Pick a column"
                options={colOptions}
              />
            </label>
            <label class="me-field">
              <span class="muted">Period column</span>
              <Picker
                testId="period-column-select"
                value={periodColumn}
                onChange={setPeriodColumn}
                placeholder="Pick a column"
                options={colOptions}
              />
            </label>
          </div>
          <div class="me-rows">
            <div class="me-rows-head">
              <span class="me-rows-title">Columns</span>
              <button
                type="button"
                class="link"
                data-testid="add-column"
                onClick={() => setAggRows((r) => [...r, { column: '', dataElement: '', categoryOptionCombo: '' }])}
              >
                Add column
              </button>
            </div>
            {aggRows.map((row, i) => (
              <div key={i} class="me-row me-row-3" data-testid={`column-row-${i}`}>
                <Picker
                  testId={`column-key-${i}`}
                  value={row.column}
                  onChange={(v) => setAggRows((r) => r.map((x, j) => (j === i ? { ...x, column: v } : x)))}
                  placeholder="Report column"
                  options={colOptions}
                />
                <Picker
                  testId={`column-de-${i}`}
                  disabled={metaEmpty}
                  value={row.dataElement}
                  onChange={(v) => setAggRows((r) => r.map((x, j) => (j === i ? { ...x, dataElement: v } : x)))}
                  placeholder="Data element"
                  options={deOptions}
                />
                <Picker
                  testId={`column-coc-${i}`}
                  disabled={metaEmpty}
                  value={row.categoryOptionCombo}
                  onChange={(v) => setAggRows((r) => r.map((x, j) => (j === i ? { ...x, categoryOptionCombo: v } : x)))}
                  placeholder="Category option combo"
                  options={cocOptions}
                />
                <button
                  type="button"
                  class="link me-remove"
                  onClick={() => setAggRows((r) => r.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <label class="me-field">
            <span class="muted">Source event source</span>
            <Picker
              testId="event-source-select"
              value={sourceId}
              onChange={(v) => {
                setSourceId(v);
                setProblems(null);
              }}
              placeholder="Pick an event source"
              searchPlaceholder="Search event sources…"
              options={eventSources.map((s) => ({ value: s.id, label: s.name }))}
            />
          </label>
          <div class="me-grid me-grid-2">
            <label class="me-field">
              <span class="muted">Program</span>
              <Picker
                testId="program-select"
                disabled={metaEmpty}
                value={program}
                onChange={(v) => {
                  setProgram(v);
                  setProgramStage('');
                }}
                placeholder="Pick a program"
                options={(meta?.programs ?? []).map((p) => ({ value: p.id, label: p.name }))}
              />
            </label>
            <label class="me-field">
              <span class="muted">Program stage</span>
              <Picker
                testId="program-stage-select"
                disabled={metaEmpty || !program}
                value={programStage}
                onChange={setProgramStage}
                placeholder="Pick a stage"
                options={stages.map((s) => ({ value: s.id, label: s.name }))}
              />
            </label>
          </div>
          <div class="me-grid me-grid-3">
            <label class="me-field">
              <span class="muted">Org-unit column</span>
              <Picker
                testId="tracker-orgunit-select"
                value={trkOrgUnitColumn}
                onChange={setTrkOrgUnitColumn}
                placeholder="Pick a column"
                options={srcColOptions}
              />
            </label>
            <label class="me-field">
              <span class="muted">Event-date column</span>
              <Picker
                testId="tracker-eventdate-select"
                value={eventDateColumn}
                onChange={setEventDateColumn}
                placeholder="Pick a column"
                options={srcColOptions}
              />
            </label>
            <label class="me-field">
              <span class="muted">Id column</span>
              <Picker
                testId="tracker-id-select"
                value={idColumn}
                onChange={setIdColumn}
                placeholder="Pick a column"
                options={srcColOptions}
              />
            </label>
          </div>
          <div class="me-rows">
            <div class="me-rows-head">
              <span class="me-rows-title">Data values</span>
              <button
                type="button"
                class="link"
                data-testid="add-datavalue"
                onClick={() => setTrkRows((r) => [...r, { column: '', dataElement: '' }])}
              >
                Add row
              </button>
            </div>
            {trkRows.map((row, i) => (
              <div key={i} class="me-row me-row-2" data-testid={`dv-row-${i}`}>
                <Picker
                  testId={`dv-col-${i}`}
                  value={row.column}
                  onChange={(v) => setTrkRows((r) => r.map((x, j) => (j === i ? { ...x, column: v } : x)))}
                  placeholder="Event column"
                  options={srcColOptions}
                />
                <Picker
                  testId={`dv-de-${i}`}
                  disabled={metaEmpty}
                  value={row.dataElement}
                  onChange={(v) => setTrkRows((r) => r.map((x, j) => (j === i ? { ...x, dataElement: v } : x)))}
                  placeholder="Data element"
                  options={deOptions}
                />
                <button
                  type="button"
                  class="link me-remove"
                  onClick={() => setTrkRows((r) => r.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {problems !== null && (
        <div class="me-problems" data-testid="validate-problems">
          {problems.length === 0 ? (
            <span class="muted">No problems.</span>
          ) : (
            <ul class="me-problems-list">
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div class="me-actions">
        <button
          type="button"
          class="btn me-validate-btn"
          data-testid="validate-mapping"
          disabled={!connectorId}
          title={connectorId ? undefined : 'Select a connector to validate'}
          onClick={() => void onValidate()}
        >
          Validate
        </button>
        <button type="button" class="btn" data-testid="save-mapping" onClick={() => void onSave()}>
          Save
        </button>
        <button type="button" class="link" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
