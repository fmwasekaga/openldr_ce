import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listDhis2Schedules: vi.fn(), listDhis2Mappings: vi.fn(), createDhis2Schedule: vi.fn(), setDhis2ScheduleEnabled: vi.fn(), deleteDhis2Schedule: vi.fn() };
});
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }) }));

import { listDhis2Schedules, listDhis2Mappings, setDhis2ScheduleEnabled } from '@/api';
import { Dhis2Schedules } from './Dhis2Schedules';

beforeEach(() => {
  vi.clearAllMocks();
  (listDhis2Mappings as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'm1', name: 'Agg One', kind: 'aggregate' }]);
  (listDhis2Schedules as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 's1', mappingId: 'm1', mappingName: 'Agg One', mode: 'aggregate', periodType: 'quarterly', eventDriven: false, enabled: true, lastRunAt: null, nextDueAt: null },
  ]);
});

describe('DHIS2 schedules page', () => {
  it('lists schedules and toggles enabled', async () => {
    (setDhis2ScheduleEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<MemoryRouter><Dhis2Schedules /></MemoryRouter>);
    expect((await screen.findAllByText('Agg One')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('toggle-s1'));
    await waitFor(() => expect(setDhis2ScheduleEnabled).toHaveBeenCalledWith('s1', false));
  });
});
