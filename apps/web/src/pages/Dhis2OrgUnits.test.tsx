import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getOrgUnitMappings: vi.fn(), setOrgUnitMapping: vi.fn(), clearOrgUnitMapping: vi.fn() };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }),
}));

import { getOrgUnitMappings, setOrgUnitMapping, clearOrgUnitMapping } from '@/api';
import { Dhis2OrgUnits } from './Dhis2OrgUnits';

const mapped = {
  facilities: [
    { facilityId: 'loc-1', facilityName: 'Clinic A', orgUnitId: 'ou1', orgUnitName: 'OU One' },
    { facilityId: 'loc-2', facilityName: 'Clinic B', orgUnitId: null, orgUnitName: null },
  ],
  orgUnits: [{ id: 'ou1', name: 'OU One' }, { id: 'ou2', name: 'OU Two' }],
  metadataPulledAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => { vi.clearAllMocks(); });

describe('DHIS2 OrgUnits page', () => {
  it('lists facilities with current mapping + unmapped badge', async () => {
    (getOrgUnitMappings as ReturnType<typeof vi.fn>).mockResolvedValue(mapped);
    render(<MemoryRouter><Dhis2OrgUnits /></MemoryRouter>);
    expect(await screen.findByText('Clinic A')).toBeTruthy();
    // "OU One" also appears as a combobox option, so scope to the mapped row
    const row1 = screen.getByTestId('orgunit-row-loc-1');
    expect(within(row1).getAllByText(/OU One/).length).toBeGreaterThan(0);
    expect(screen.getByText(/unmapped/i)).toBeTruthy();
  });

  it('sets a mapping via the combobox', async () => {
    (getOrgUnitMappings as ReturnType<typeof vi.fn>).mockResolvedValue(mapped);
    (setOrgUnitMapping as ReturnType<typeof vi.fn>).mockResolvedValue({ facilityId: 'loc-2', orgUnitId: 'ou2', orgUnitName: 'OU Two' });
    render(<MemoryRouter><Dhis2OrgUnits /></MemoryRouter>);
    await screen.findByText('Clinic B');
    // Open the combobox in Clinic B's row (the unmapped picker) and choose OU Two.
    const picker = screen.getByTestId('orgunit-picker-loc-2');
    const triggerBtn = picker.querySelector('button') ?? picker;
    fireEvent.click(triggerBtn);
    fireEvent.click(await screen.findByText('OU Two'));
    await waitFor(() => expect(setOrgUnitMapping).toHaveBeenCalledWith('loc-2', { orgUnitId: 'ou2', orgUnitName: 'OU Two' }));
  });

  it('shows the empty-catalog state when never pulled', async () => {
    (getOrgUnitMappings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...mapped, orgUnits: [], metadataPulledAt: null });
    render(<MemoryRouter><Dhis2OrgUnits /></MemoryRouter>);
    expect(await screen.findByText(/no orgunit catalog yet/i)).toBeTruthy();
  });
});
