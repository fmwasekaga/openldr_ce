import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

const { createSchedule } = vi.hoisted(() => ({ createSchedule: vi.fn(async () => ({ id: 's1' })) }));
vi.mock('../api', () => ({ createSchedule, updateSchedule: vi.fn(async () => ({ id: 's1' })) }));

import { ScheduleDialog } from './ScheduleDialog';
import type { ReportParamMeta } from '../api';

const parameters: ReportParamMeta[] = [
  { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
  { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' },
];

beforeEach(() => createSchedule.mockClear());

describe('ScheduleDialog', () => {
  it('creates a schedule with the selected frequency + params', async () => {
    const onSaved = vi.fn();
    render(
      <ScheduleDialog open reportId="amr-resistance" parameters={parameters}
        options={{ facility: ['F1'] }} initialParams={{ facility: 'F1' }}
        onClose={() => {}} onSaved={onSaved} />,
    );
    expect(screen.queryByText(/day of week|jour de la semaine|dia da semana/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save|enregistrer|salvar/i }));
    await waitFor(() => expect(createSchedule).toHaveBeenCalledWith('amr-resistance', expect.objectContaining({
      frequency: 'monthly', outputFormat: expect.any(String), params: { facility: 'F1' },
    })));
    expect(onSaved).toHaveBeenCalled();
  });

  it('locks output format to PDF when pdfOnly', async () => {
    render(
      <ScheduleDialog open pdfOnly reportId="custom-1" parameters={parameters}
        options={{ facility: ['F1'] }} initialParams={{}}
        onClose={() => {}} onSaved={() => {}} />,
    );
    // The output-format selector (with CSV / XLSX choices) must not be offered.
    expect(screen.queryByText('CSV')).not.toBeInTheDocument();
    expect(screen.queryByText('XLSX')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save|enregistrer|salvar/i }));
    await waitFor(() => expect(createSchedule).toHaveBeenCalledWith('custom-1', expect.objectContaining({
      outputFormat: 'pdf',
    })));
  });
});
