import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listDhis2Pushes: vi.fn() };
});
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }) }));

import { listDhis2Pushes } from '@/api';
import { Dhis2Pushes } from './Dhis2Pushes';

beforeEach(() => { vi.clearAllMocks(); });

describe('DHIS2 pushes page', () => {
  it('renders push history rows', async () => {
    (listDhis2Pushes as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'p1', occurredAt: '2026-01-01T00:00:00Z', action: 'dhis2.push', entityId: 'm1', metadata: { period: '2026Q1', status: 'success', imported: 5 } },
    ]);
    render(<MemoryRouter><Dhis2Pushes /></MemoryRouter>);
    expect(await screen.findByText('dhis2.push')).toBeTruthy();
    expect(screen.getByText('m1')).toBeTruthy();
  });
});
