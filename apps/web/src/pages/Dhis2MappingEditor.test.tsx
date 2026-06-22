import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@/i18n';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    fetchReports: vi.fn(),
    getDhis2Metadata: vi.fn(),
    getReportColumns: vi.fn(),
    getDhis2EventSources: vi.fn(),
    getDhis2Mapping: vi.fn(),
    saveDhis2Mapping: vi.fn(),
    validateDhis2Mapping: vi.fn(),
  };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }),
}));

import { fetchReports, getDhis2Metadata, getReportColumns, getDhis2EventSources, saveDhis2Mapping, getDhis2Mapping } from '@/api';
import { Dhis2MappingEditor } from './Dhis2MappingEditor';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dhis2/mappings/new" element={<Dhis2MappingEditor />} />
        <Route path="/dhis2/mappings/:id" element={<Dhis2MappingEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

// The selects are shadcn/Radix, not native: open the trigger by data-testid, then
// click the option by its rendered text.
function pick(testid: string, optionText: string) {
  fireEvent.click(screen.getByTestId(testid));
  fireEvent.click(screen.getByText(optionText));
}

beforeEach(() => {
  vi.clearAllMocks();
  (fetchReports as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'test-volume', name: 'Test Volume', description: '' }]);
  (getDhis2Metadata as ReturnType<typeof vi.fn>).mockResolvedValue({
    dataElements: [{ id: 'de1', name: 'DE One' }], categoryOptionCombos: [{ id: 'coc1', name: 'COC One' }],
    orgUnits: [], programs: [{ id: 'prog1', name: 'Program One' }],
    programStages: [{ id: 'stage1', name: 'Stage One', program: 'prog1' }, { id: 'stageX', name: 'Other', program: 'progOther' }],
    pulledAt: '2026-01-01T00:00:00.000Z',
  });
  (getReportColumns as ReturnType<typeof vi.fn>).mockResolvedValue([{ key: 'month', label: 'Month' }, { key: 'count', label: 'Count' }]);
  (getDhis2EventSources as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 'amr-isolates', name: 'AMR isolates', columns: [{ key: 'id', label: 'Isolate ID' }, { key: 'facility', label: 'Facility' }, { key: 'eventDate', label: 'Event date' }, { key: 'result', label: 'Result' }] },
  ]);
});

describe('DHIS2 mapping editor — aggregate', () => {
  it('builds and saves a new aggregate mapping', async () => {
    (saveDhis2Mapping as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'mapping-x', name: 'My Map', definition: {} });
    renderAt('/dhis2/mappings/new');
    fireEvent.change(await screen.findByTestId('mapping-name'), { target: { value: 'My Map' } });
    pick('report-select', 'Test Volume');
    await waitFor(() => expect(getReportColumns).toHaveBeenCalledWith('test-volume'));
    await waitFor(() => pick('orgunit-column-select', 'Month'));
    fireEvent.click(screen.getByTestId('add-column'));
    pick('column-key-0', 'Count');
    pick('column-de-0', 'DE One');
    fireEvent.click(screen.getByTestId('save-mapping'));
    await waitFor(() => expect(saveDhis2Mapping).toHaveBeenCalled());
    const [, body] = (saveDhis2Mapping as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.definition.kind).toBe('aggregate');
    expect(body.definition.orgUnitColumn).toBe('month');
    expect(body.definition.columns).toEqual([{ column: 'count', dataElement: 'de1' }]);
  });
});

describe('DHIS2 mapping editor — tracker', () => {
  it('builds and saves a new tracker mapping', async () => {
    (saveDhis2Mapping as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'mapping-y', name: 'Trk', definition: {} });
    renderAt('/dhis2/mappings/new');
    await screen.findByTestId('mapping-name');
    // switch to tracker
    pick('kind-select', 'Tracker');
    fireEvent.change(screen.getByTestId('mapping-name'), { target: { value: 'Trk' } });
    pick('event-source-select', 'AMR isolates');
    pick('program-select', 'Program One');
    // program-stage options should be filtered to prog1 (Stage One only, not "Other")
    fireEvent.click(screen.getByTestId('program-stage-select'));
    expect(screen.getByText('Stage One')).toBeTruthy();
    expect(screen.queryByText('Other')).toBeNull();
    fireEvent.click(screen.getByText('Stage One'));
    pick('tracker-orgunit-select', 'Facility');
    pick('tracker-eventdate-select', 'Event date');
    pick('tracker-id-select', 'Isolate ID');
    fireEvent.click(screen.getByTestId('add-datavalue'));
    pick('dv-col-0', 'Result');
    pick('dv-de-0', 'DE One');
    fireEvent.click(screen.getByTestId('save-mapping'));
    await waitFor(() => expect(saveDhis2Mapping).toHaveBeenCalled());
    const [, body] = (saveDhis2Mapping as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.definition).toMatchObject({
      kind: 'tracker', name: 'Trk', source: { kind: 'event-source', sourceId: 'amr-isolates' },
      program: 'prog1', programStage: 'stage1', orgUnitColumn: 'facility', eventDateColumn: 'eventDate', idColumn: 'id',
      dataValues: [{ column: 'result', dataElement: 'de1' }],
    });
  });

  it('loads the tracker form when editing a tracker mapping', async () => {
    (getDhis2Mapping as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 't1', name: 'Trk',
      definition: { kind: 'tracker', id: 't1', name: 'Trk', source: { kind: 'event-source', sourceId: 'amr-isolates' }, program: 'prog1', programStage: 'stage1', orgUnitColumn: 'facility', eventDateColumn: 'eventDate', idColumn: 'id', dataValues: [{ column: 'result', dataElement: 'de1' }] },
    });
    renderAt('/dhis2/mappings/t1');
    // tracker form is shown (program select present), not a read-only notice
    expect(await screen.findByTestId('program-select')).toBeTruthy();
    expect(screen.getByTestId('event-source-select')).toHaveTextContent('AMR isolates');
  });
});
