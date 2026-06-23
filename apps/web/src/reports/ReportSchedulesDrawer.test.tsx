import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

const fetchSchedules = vi.hoisted(() => vi.fn());
const updateSchedule = vi.hoisted(() => vi.fn(async () => ({})));
const runScheduleNow = vi.hoisted(() => vi.fn(async () => {}));
const deleteSchedule = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../api', () => ({ fetchSchedules, updateSchedule, runScheduleNow, deleteSchedule }));
vi.mock('./ScheduleDialog', () => ({ ScheduleDialog: () => <div>schedule-dialog</div> }));

import { ReportSchedulesDrawer } from './ReportSchedulesDrawer';

beforeEach(() => {
  fetchSchedules.mockReset();
  fetchSchedules.mockResolvedValue([
    { id: 's1', reportId: 'amr-resistance', params: {}, frequency: 'weekly', dayOfWeek: 1, dayOfMonth: null, outputFormat: 'pdf', enabled: true, lastRunAt: null, nextDueAt: '2026-03-16T06:00:00Z', createdBy: 'u1' },
  ]);
  updateSchedule.mockClear(); runScheduleNow.mockClear();
});

function setup() {
  render(<ReportSchedulesDrawer open reportId="amr-resistance" parameters={[]} options={{}} currentParams={{}} onClose={() => {}} />);
}

describe('ReportSchedulesDrawer', () => {
  it('lists schedules and toggling the switch updates it', async () => {
    setup();
    await screen.findByRole('switch');
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(updateSchedule).toHaveBeenCalledWith('s1', { enabled: false }));
  });

  it('run-now fires runScheduleNow', async () => {
    setup();
    await screen.findByRole('switch');
    fireEvent.click(screen.getByRole('button', { name: /run now|exécuter|executar/i }));
    await waitFor(() => expect(runScheduleNow).toHaveBeenCalledWith('s1'));
  });
});
