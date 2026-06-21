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
    getDhis2Mapping: vi.fn(),
    saveDhis2Mapping: vi.fn(),
    validateDhis2Mapping: vi.fn(),
  };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }),
}));

import { fetchReports, getDhis2Metadata, getReportColumns, saveDhis2Mapping, getDhis2Mapping } from '@/api';
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

beforeEach(() => {
  vi.clearAllMocks();
  (fetchReports as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'test-volume', name: 'Test Volume', description: '' }]);
  (getDhis2Metadata as ReturnType<typeof vi.fn>).mockResolvedValue({
    dataElements: [{ id: 'de1', name: 'DE One' }], categoryOptionCombos: [{ id: 'coc1', name: 'COC One' }],
    orgUnits: [], programs: [], programStages: [], pulledAt: '2026-01-01T00:00:00.000Z',
  });
  (getReportColumns as ReturnType<typeof vi.fn>).mockResolvedValue([{ key: 'month', label: 'Month' }, { key: 'count', label: 'Count' }]);
});

describe('DHIS2 aggregate mapping editor', () => {
  it('builds and saves a new aggregate mapping', async () => {
    (saveDhis2Mapping as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'mapping-x', name: 'My Map', definition: {} });
    renderAt('/dhis2/mappings/new');
    // name
    fireEvent.change(await screen.findByTestId('mapping-name'), { target: { value: 'My Map' } });
    // pick source report → triggers getReportColumns
    fireEvent.change(screen.getByTestId('report-select'), { target: { value: 'test-volume' } });
    await waitFor(() => expect(getReportColumns).toHaveBeenCalledWith('test-volume'));
    // orgUnit column
    fireEvent.change(screen.getByTestId('orgunit-column-select'), { target: { value: 'month' } });
    // add a column-mapping row, set report column + dataElement
    fireEvent.click(screen.getByTestId('add-column'));
    fireEvent.change(screen.getByTestId('column-key-0'), { target: { value: 'count' } });
    fireEvent.change(screen.getByTestId('column-de-0'), { target: { value: 'de1' } });
    // save
    fireEvent.click(screen.getByTestId('save-mapping'));
    await waitFor(() => expect(saveDhis2Mapping).toHaveBeenCalled());
    const [, body] = (saveDhis2Mapping as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(body.name).toBe('My Map');
    expect(body.definition.source.reportId).toBe('test-volume');
    expect(body.definition.orgUnitColumn).toBe('month');
    expect(body.definition.columns).toEqual([{ column: 'count', dataElement: 'de1' }]);
  });

  it('shows a read-only notice for tracker mappings', async () => {
    (getDhis2Mapping as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm2', name: 'Trk', definition: { kind: 'tracker', id: 'm2', name: 'Trk' } });
    renderAt('/dhis2/mappings/m2');
    expect(await screen.findByText(/tracker editing comes in/i)).toBeTruthy();
  });
});
