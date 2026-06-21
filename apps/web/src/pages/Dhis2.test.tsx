import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getDhis2Status: vi.fn(), pullDhis2Metadata: vi.fn() };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }),
}));

import { getDhis2Status, pullDhis2Metadata } from '@/api';
import { Dhis2 } from './Dhis2';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DHIS2 settings page', () => {
  it('shows the not-configured empty state', async () => {
    (getDhis2Status as ReturnType<typeof vi.fn>).mockResolvedValue({
      configured: false, syncEnabled: false, host: null, reachable: null, counts: null, recentPushes: [],
    });
    render(<MemoryRouter><Dhis2 /></MemoryRouter>);
    expect(await screen.findByText(/Not configured/i)).toBeTruthy();
  });

  it('shows host + reachability and pulls metadata when configured', async () => {
    (getDhis2Status as ReturnType<typeof vi.fn>).mockResolvedValue({
      configured: true, syncEnabled: true, host: 'play.dhis2.example', reachable: { status: 'up', latencyMs: 10 },
      counts: { mappings: 2, orgUnitMappings: 1, schedules: 0 }, recentPushes: [],
    });
    (pullDhis2Metadata as ReturnType<typeof vi.fn>).mockResolvedValue({
      dataElements: 5, orgUnits: 3, categoryOptionCombos: 4, programs: 1, programStages: 2,
    });
    render(<MemoryRouter><Dhis2 /></MemoryRouter>);
    expect(await screen.findByText('play.dhis2.example')).toBeTruthy();

    fireEvent.click(screen.getByTestId('dhis2-pull-metadata'));
    await waitFor(() => expect(pullDhis2Metadata).toHaveBeenCalled());
    expect(await screen.findByText('5')).toBeTruthy(); // dataElements count
  });
});
