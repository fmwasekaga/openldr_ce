import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', () => ({
  fetchActivity: vi.fn(async () => [
    { correlationId: 'A', workflowId: 'w', source: 'webhook', startedAt: '2026-07-03T10:00:00Z', currentStage: 'persisted', status: 'complete' },
  ]),
  fetchLifecycle: vi.fn(async () => ({
    correlationId: 'A',
    status: 'complete',
    stages: [
      { stage: 'received', status: 'ok', at: '2026-07-03T10:00:00Z', detail: 'webhook' },
      { stage: 'persisted', status: 'ok', at: '2026-07-03T10:00:05Z', detail: '1 × ServiceRequest' },
    ],
    runIds: ['run-1'],
  })),
  listPluginUis: vi.fn(async () => []),
}));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasRole: () => true }),
}));

import { Activity } from './Activity';

describe('Activity page', () => {
  it('lists recent payloads with their stage', async () => {
    render(<MemoryRouter><Activity /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Persisted')).toBeInTheDocument());
  });

  it('opens the lifecycle detail when a row is clicked', async () => {
    const api = await import('@/api');
    render(<MemoryRouter><Activity /></MemoryRouter>);
    fireEvent.click(await screen.findByText('webhook'));
    await waitFor(() => expect(api.fetchLifecycle).toHaveBeenCalledWith('A'));
    expect(await screen.findByText('1 × ServiceRequest')).toBeInTheDocument();
  });
});
