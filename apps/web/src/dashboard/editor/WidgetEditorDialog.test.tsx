import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { WidgetEditorDialog } from './WidgetEditorDialog';

afterEach(() => vi.restoreAllMocks());

describe('WidgetEditorDialog', () => {
  it('saves a SQL widget', () => {
    // Only the models fetch happens on mount for a new (no-initial) widget.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    const onSave = vi.fn();
    const { getByLabelText, getByText } = render(<WidgetEditorDialog open dashboardFilters={[]} onClose={() => {}} onSave={onSave} />);
    fireEvent.change(getByLabelText('Title'), { target: { value: 'My SQL' } });
    fireEvent.change(getByLabelText('SQL'), { target: { value: 'select 2 as value' } });
    fireEvent.click(getByText('Save'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'My SQL', query: expect.objectContaining({ mode: 'sql', sql: 'select 2 as value' }) }),
    );
  });
});
