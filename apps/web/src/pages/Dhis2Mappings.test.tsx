import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listDhis2Mappings: vi.fn(), deleteDhis2Mapping: vi.fn(), runDhis2Mapping: vi.fn() };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }),
}));

import { listDhis2Mappings, deleteDhis2Mapping, runDhis2Mapping } from '@/api';
import { Dhis2Mappings } from './Dhis2Mappings';

beforeEach(() => { vi.clearAllMocks(); });

describe('DHIS2 mappings list', () => {
  it('lists mappings with kind badges', async () => {
    (listDhis2Mappings as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'm1', name: 'Agg One', kind: 'aggregate' },
      { id: 'm2', name: 'Trk', kind: 'tracker' },
    ]);
    render(<MemoryRouter><Dhis2Mappings /></MemoryRouter>);
    expect(await screen.findByText('Agg One')).toBeTruthy();
    expect(screen.getByText('tracker')).toBeTruthy();
  });

  it('deletes a mapping behind a confirm', async () => {
    (listDhis2Mappings as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'm1', name: 'Agg One', kind: 'aggregate' }]);
    (deleteDhis2Mapping as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<MemoryRouter><Dhis2Mappings /></MemoryRouter>);
    await screen.findByText('Agg One');
    fireEvent.click(screen.getByTestId('delete-m1'));
    const confirm = await screen.findByRole('button', { name: /^delete$/i });
    fireEvent.click(confirm);
    await waitFor(() => expect(deleteDhis2Mapping).toHaveBeenCalledWith('m1'));
  });
});

describe('DHIS2 mappings — run dialog', () => {
  it('dry-runs a mapping and shows counts', async () => {
    (listDhis2Mappings as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'm1', name: 'Agg One', kind: 'aggregate' }]);
    (runDhis2Mapping as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: 'aggregate', dryRun: true, counts: { values: 5, skipped: 1 }, skipped: [{ row: 2, reason: 'no orgUnit' }], result: null });
    render(<MemoryRouter><Dhis2Mappings /></MemoryRouter>);
    await screen.findByText('Agg One');
    fireEvent.click(screen.getByTestId('run-m1'));
    fireEvent.change(await screen.findByTestId('run-period'), { target: { value: '2026Q1' } });
    fireEvent.click(screen.getByTestId('run-dry'));
    await waitFor(() => expect(runDhis2Mapping).toHaveBeenCalledWith('m1', { period: '2026Q1', dryRun: true }));
    expect(await screen.findByText('5')).toBeTruthy(); // values count
  });
});
