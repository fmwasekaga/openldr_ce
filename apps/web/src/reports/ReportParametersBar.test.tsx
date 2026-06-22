import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { ReportParametersBar } from './ReportParametersBar';
import type { ReportSummary } from '../api';

const report: ReportSummary = {
  id: 'amr-resistance', name: 'AMR', description: '', category: 'amr',
  parameters: [
    { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
    { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' },
  ],
};

describe('ReportParametersBar', () => {
  it('renders a Run button that fires onRun', () => {
    const onRun = vi.fn();
    render(
      <ReportParametersBar
        report={report} params={{}} options={{ facility: ['F1'] }}
        onChange={() => {}} onRun={onRun} running={false} canRun
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /run|exécuter|executar/i }));
    expect(onRun).toHaveBeenCalled();
  });

  it('disables Run when canRun is false', () => {
    render(
      <ReportParametersBar
        report={report} params={{}} options={{}}
        onChange={() => {}} onRun={() => {}} running={false} canRun={false}
      />,
    );
    expect(screen.getByRole('button', { name: /run|exécuter|executar/i })).toBeDisabled();
  });
});
