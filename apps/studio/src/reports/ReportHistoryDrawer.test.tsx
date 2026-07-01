import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('../api', () => ({
  fetchReportRuns: vi.fn(async () => ({
    runs: [{ id: 'r1', reportId: 'amr-resistance', reportName: 'AMR', format: 'preview', params: { from: '2026-01-01' }, rowCount: 3, userName: 'ada', createdAt: '2026-01-01T10:00:00Z' }],
    total: 1,
  })),
  fetchScheduleRuns: vi.fn(async () => ({
    runs: [{ id: 'run1', scheduleId: 's1', reportId: 'amr-resistance', reportName: 'AMR', runAt: '2026-03-16T06:05:00Z', periodStart: null, periodEnd: null, outputFormat: 'csv', objectKey: 'k', byteSize: 4, rowCount: 1, status: 'success', errorMessage: null }],
    total: 1,
  })),
  downloadScheduleRun: vi.fn(async () => {}),
}));

import { ReportHistoryDrawer } from './ReportHistoryDrawer';

describe('ReportHistoryDrawer', () => {
  it('loads activity runs and re-applies params on row click', async () => {
    const onApplyParams = vi.fn();
    render(<ReportHistoryDrawer open reportId="amr-resistance" onClose={() => {}} onApplyParams={onApplyParams} />);
    const userCell = await screen.findByText('ada');
    fireEvent.click(userCell);
    await waitFor(() => expect(onApplyParams).toHaveBeenCalledWith({ from: '2026-01-01' }));
  });

  it('shows scheduled runs in the second tab with a download', async () => {
    const api = await import('../api');
    render(<ReportHistoryDrawer open reportId="amr-resistance" onClose={() => {}} onApplyParams={() => {}} />);
    const tab = await screen.findByRole('tab', { name: /scheduled runs|exécutions planifiées|execuções agendadas/i });
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.click(await screen.findByRole('button', { name: /download|télécharger|baixar/i }));
    await waitFor(() => expect(api.downloadScheduleRun).toHaveBeenCalledWith('run1'));
  });
});
