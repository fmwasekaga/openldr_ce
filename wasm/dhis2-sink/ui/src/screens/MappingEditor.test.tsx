import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { createMockOpenldr } from '@openldr/plugin-ui-sdk';
import { MappingEditor } from './MappingEditor';

const REPORTS = [
  { id: 'r1', name: 'AMR aggregate' },
  { id: 'r2', name: 'Other report' },
];

const REPORT_COLUMNS = [
  { key: 'facility', label: 'Facility' },
  { key: 'period', label: 'Period' },
  { key: 'count', label: 'Count' },
];

const EVENT_SOURCES = [
  {
    id: 'es1',
    name: 'AMR events',
    columns: [
      { key: 'org', label: 'Org' },
      { key: 'date', label: 'Date' },
      { key: 'uid', label: 'Uid' },
      { key: 'value', label: 'Value' },
    ],
  },
];

const METADATA_CACHE = {
  pulledAt: '2026-06-24T00:00:00.000Z',
  metadata: {
    dataElements: [
      { id: 'de1', name: 'Confirmed cases' },
      { id: 'de2', name: 'Suspected cases' },
    ],
    categoryOptionCombos: [{ id: 'coc1', name: 'Default' }],
    programs: [{ id: 'p1', name: 'AMR program' }],
    programStages: [
      { id: 'ps1', name: 'Stage 1', program: 'p1' },
      { id: 'ps2', name: 'Other stage', program: 'pX' },
    ],
    orgUnits: [{ id: 'ou1', name: 'Clinic' }],
  },
};

const CONNECTORS = [
  { id: 'c1', name: 'DHIS2 demo', enabled: true },
  { id: 'c2', name: 'Disabled', enabled: false },
];

/** Build a mock with the editor's load deps wired, plus optional saved mappings. */
function buildMock(savedMappings: Record<string, unknown> = {}) {
  const o = createMockOpenldr({ pluginId: 'dhis2-sink' });
  o.reports.list = (async () => REPORTS) as typeof o.reports.list;
  o.reports.eventSources = (async () => EVENT_SOURCES) as typeof o.reports.eventSources;
  const columnsSpy = vi.fn(async () => REPORT_COLUMNS);
  o.reports.columns = columnsSpy as typeof o.reports.columns;
  o.connectors.list = (async () => CONNECTORS) as typeof o.connectors.list;
  const validateSpy = vi.fn(async () => ['Org-unit column is required']);
  o.connectors.validate = validateSpy as typeof o.connectors.validate;
  const putSpy = vi.fn(async () => {});
  o.storage.put = putSpy as typeof o.storage.put;
  o.storage.get = (async (c: string, key: string) => {
    if (c === 'metadataCache' && key === 'latest') return METADATA_CACHE;
    if (c === 'mappings') return savedMappings[key] ?? null;
    return null;
  }) as typeof o.storage.get;
  (window as unknown as { openldr: unknown }).openldr = o;
  return { columnsSpy, validateSpy, putSpy };
}

/** Open a Picker (by testId) and click the option whose label matches. */
async function pick(testId: string, label: string | RegExp) {
  const picker = await screen.findByTestId(testId);
  const trigger = picker.querySelector('.picker-trigger') as HTMLElement;
  fireEvent.click(trigger);
  const opts = await screen.findAllByRole('option');
  const matcher = (t: string) => (label instanceof RegExp ? label.test(t) : t.includes(label));
  const target = opts.find((el) => matcher(el.textContent ?? ''));
  if (!target) throw new Error(`option "${label}" not found in ${testId}`);
  fireEvent.click(target);
}

describe('dhis2-sink MappingEditor', () => {
  it('aggregate: pick connector + report (loads columns) + org-unit column + a column row, validate, then save', async () => {
    const { columnsSpy, validateSpy, putSpy } = buildMock();
    const onDone = vi.fn();
    render(<MappingEditor onDone={onDone} />);

    await screen.findByTestId('dhis2-mapping-editor');

    fireEvent.input(screen.getByTestId('mapping-name'), { target: { value: 'My agg' } });

    await pick('connector-select', 'DHIS2 demo');
    await pick('report-select', 'AMR aggregate');
    await waitFor(() => expect(columnsSpy).toHaveBeenCalledWith('r1'));

    await pick('orgunit-column-select', 'Facility');

    fireEvent.click(screen.getByTestId('add-column'));
    await screen.findByTestId('column-row-0');
    await pick('column-key-0', 'Count');
    await pick('column-de-0', 'Confirmed cases');
    await pick('column-coc-0', 'Default');

    // Validate runs with {connectorId, mapping} carrying the aggregate def.
    fireEvent.click(screen.getByTestId('validate-mapping'));
    await waitFor(() => expect(validateSpy).toHaveBeenCalledTimes(1));
    const vArg = (validateSpy.mock.calls[0] as unknown as [{ connectorId: string; mapping: Record<string, unknown> }])[0];
    expect(vArg.connectorId).toBe('c1');
    expect(vArg.mapping.kind).toBe('aggregate');
    expect((vArg.mapping.source as { reportId: string }).reportId).toBe('r1');
    expect(vArg.mapping.columns).toEqual([{ column: 'count', dataElement: 'de1', categoryOptionCombo: 'coc1' }]);

    // The returned problems render.
    const problems = await screen.findByTestId('validate-problems');
    expect(problems.textContent).toContain('Org-unit column is required');

    // Save persists the aggregate definition + returns to the list.
    fireEvent.click(screen.getByTestId('save-mapping'));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const [coll, id, payload] = putSpy.mock.calls[0] as unknown as [string, string, { id: string; name: string; definition: Record<string, unknown> }];
    expect(coll).toBe('mappings');
    expect(id).toMatch(/^mapping-/);
    expect(payload.id).toBe(id);
    expect(payload.name).toBe('My agg');
    expect(payload.definition.kind).toBe('aggregate');
    expect(payload.definition.connectorId).toBe('c1');
    expect(payload.definition.orgUnitColumn).toBe('facility');
    expect((payload.definition.source as { reportId: string }).reportId).toBe('r1');
    expect(payload.definition.columns).toEqual([{ column: 'count', dataElement: 'de1', categoryOptionCombo: 'coc1' }]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('tracker: switch kind, pick event source + program + stage + a data-value row, then save the tracker definition', async () => {
    const { putSpy } = buildMock();
    const onDone = vi.fn();
    render(<MappingEditor onDone={onDone} />);

    await screen.findByTestId('dhis2-mapping-editor');
    fireEvent.input(screen.getByTestId('mapping-name'), { target: { value: 'My trk' } });

    await pick('kind-select', 'Tracker');
    // Tracker branch is now rendered.
    await screen.findByTestId('event-source-select');

    await pick('connector-select', 'DHIS2 demo');
    await pick('event-source-select', 'AMR events');
    await pick('program-select', 'AMR program');
    // Only the stage belonging to p1 is offered.
    await pick('program-stage-select', 'Stage 1');
    await pick('tracker-orgunit-select', 'Org');
    await pick('tracker-eventdate-select', 'Date');
    await pick('tracker-id-select', 'Uid');

    fireEvent.click(screen.getByTestId('add-datavalue'));
    await screen.findByTestId('dv-row-0');
    await pick('dv-col-0', 'Value');
    await pick('dv-de-0', 'Confirmed cases');

    fireEvent.click(screen.getByTestId('save-mapping'));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const [, , payload] = putSpy.mock.calls[0] as unknown as [string, string, { definition: Record<string, unknown> }];
    const d = payload.definition;
    expect(d.kind).toBe('tracker');
    expect((d.source as { kind: string; sourceId: string })).toEqual({ kind: 'event-source', sourceId: 'es1' });
    expect(d.program).toBe('p1');
    expect(d.programStage).toBe('ps1');
    expect(d.orgUnitColumn).toBe('org');
    expect(d.eventDateColumn).toBe('date');
    expect(d.idColumn).toBe('uid');
    expect(d.dataValues).toEqual([{ column: 'value', dataElement: 'de1' }]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('edit: hydrates the form from a saved aggregate mapping and loads its report columns', async () => {
    const saved = {
      m1: {
        id: 'm1',
        name: 'Saved agg',
        definition: {
          kind: 'aggregate',
          id: 'm1',
          name: 'Saved agg',
          connectorId: 'c1',
          source: { kind: 'report', reportId: 'r1' },
          orgUnitColumn: 'facility',
          periodColumn: 'period',
          columns: [{ column: 'count', dataElement: 'de2' }],
        },
      },
    };
    const { columnsSpy } = buildMock(saved);
    render(<MappingEditor mappingId="m1" onDone={() => {}} />);

    await screen.findByTestId('dhis2-mapping-editor');
    // Name hydrated.
    await waitFor(() => expect((screen.getByTestId('mapping-name') as HTMLInputElement).value).toBe('Saved agg'));
    // Report columns loaded for the saved report.
    expect(columnsSpy).toHaveBeenCalledWith('r1');
    // The saved column row rendered (so reportId + columns hydrated).
    await screen.findByTestId('column-row-0');
    // No kind toggle in edit mode.
    expect(screen.queryByTestId('kind-select')).toBeNull();
  });

  it('not-found: an unknown mappingId shows the not-found state', async () => {
    buildMock();
    render(<MappingEditor mappingId="nope" onDone={() => {}} />);
    await waitFor(() => expect(screen.getByText('That mapping no longer exists.')).toBeTruthy());
  });

  it('validate without a connector does not call connectors.validate (button disabled)', async () => {
    const { validateSpy } = buildMock();
    render(<MappingEditor onDone={() => {}} />);
    await screen.findByTestId('dhis2-mapping-editor');

    const validateBtn = screen.getByTestId('validate-mapping') as HTMLButtonElement;
    expect(validateBtn.disabled).toBe(true);
    fireEvent.click(validateBtn);
    expect(validateSpy).not.toHaveBeenCalled();
  });
});
