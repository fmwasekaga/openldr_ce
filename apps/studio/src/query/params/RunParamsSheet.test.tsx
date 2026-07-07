// apps/studio/src/query/params/RunParamsSheet.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RunParamsSheet } from './RunParamsSheet';
import type { CustomQueryParam } from '../custom-query-types';

vi.mock('../api', () => ({ queryApi: { paramOptions: vi.fn(async () => ['Ndola', 'Lusaka']) } }));

const params: CustomQueryParam[] = [
  { id: 'dateRange', label: 'Date range', type: 'daterange', required: false },
  { id: 'facility', label: 'Facility', type: 'select', required: false, optionsSql: 'select distinct f from t' },
];

describe('RunParamsSheet', () => {
  it('renders a control per declared type and returns values on run', () => {
    const onRun = vi.fn();
    render(<RunParamsSheet open params={params} connectorId="c1" onClose={() => {}} onRun={onRun} />);
    fireEvent.change(screen.getByLabelText('dateRange-from'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('dateRange-to'), { target: { value: '2026-06-30' } });
    fireEvent.click(screen.getByRole('button', { name: /run with these values/i }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ dateRange: { from: '2026-01-01', to: '2026-06-30' } }));
  });
});
