import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('../api', () => ({
  fetchReportRuns: vi.fn(async () => ({
    runs: [
      { id: 'r1', reportId: 'amr-resistance', reportName: 'AMR', format: 'preview', params: { from: '2026-01-01' }, rowCount: 3, userName: 'ada', createdAt: '2026-01-01T10:00:00Z' },
    ],
    total: 1,
  })),
}));

import { ReportHistoryDrawer } from './ReportHistoryDrawer';

describe('ReportHistoryDrawer', () => {
  it('loads runs and re-applies params on row click', async () => {
    const onApplyParams = vi.fn();
    render(
      <ReportHistoryDrawer open reportId="amr-resistance" onClose={() => {}} onApplyParams={onApplyParams} />,
    );
    const userCell = await screen.findByText('ada');
    expect(screen.getByText('preview')).toBeInTheDocument();
    fireEvent.click(userCell);
    await waitFor(() => expect(onApplyParams).toHaveBeenCalledWith({ from: '2026-01-01' }));
  });
});
