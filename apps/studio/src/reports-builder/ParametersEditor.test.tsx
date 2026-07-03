import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ParametersEditor } from './ParametersEditor';
import type { ReportParam } from '@openldr/report-builder/pure';

describe('ParametersEditor', () => {
  it('adds a parameter and saves it to the list', () => {
    const onSave = vi.fn();
    render(<ParametersEditor open parameters={[]} onClose={() => {}} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /add parameter/i }));
    fireEvent.click(screen.getByRole('button', { name: /save parameters/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as ReportParam[];
    expect(saved).toHaveLength(1);
    expect(saved[0].type).toBe('text');
  });

  it('reveals Options SQL only for select type', () => {
    const params: ReportParam[] = [{ id: 'site', label: 'Site', type: 'text', required: false }];
    render(<ParametersEditor open parameters={params} onClose={() => {}} onSave={() => {}} />);
    expect(screen.queryByLabelText('param-0-options-sql')).toBeNull();
    fireEvent.change(screen.getByLabelText('param-0-type'), { target: { value: 'select' } });
    expect(screen.getByLabelText('param-0-options-sql')).toBeTruthy();
  });
});
