import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SqlQueryEditor } from './SqlQueryEditor';
import type { ReportParam } from '@openldr/report-builder/pure';

const PARAMS: ReportParam[] = [{ id: 'site', label: 'Site', type: 'select', required: false }];

describe('SqlQueryEditor', () => {
  it('renders the SQL textarea and makes it read-only when sqlEnabled is false', () => {
    render(<SqlQueryEditor open sql="select 1 as value" values={{}} parameters={PARAMS} sqlEnabled={false} onClose={() => {}} onSave={() => {}} />);
    expect((screen.getByLabelText('SQL') as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it('keeps the SQL textarea editable when sqlEnabled is true', () => {
    render(<SqlQueryEditor open sql="select 1 as value" values={{}} parameters={PARAMS} sqlEnabled onClose={() => {}} onSave={() => {}} />);
    expect((screen.getByLabelText('SQL') as HTMLTextAreaElement).readOnly).toBe(false);
  });

  it('detects a {{var}} and binds it to a parameter, saving a {{param.id}} token', () => {
    const onSave = vi.fn();
    render(<SqlQueryEditor open sql="select * from t where ward = {{ward}}" values={{}} parameters={PARAMS} sqlEnabled onClose={() => {}} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('bind-ward'), { target: { value: 'site' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith({ mode: 'sql', sql: 'select * from t where ward = {{ward}}', values: { ward: '{{param.site}}' } });
  });
});
