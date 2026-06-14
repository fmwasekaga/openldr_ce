import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { WidgetEditorDialog } from './WidgetEditorDialog';

afterEach(() => vi.restoreAllMocks());

describe('WidgetEditorDialog', () => {
  it('loads models, previews, and saves a widget', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: unknown) => {
      if (String(url).endsWith('/models'))
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'service_requests',
                label: 'Test Orders',
                metrics: [{ key: 'count', label: 'Count', agg: 'count' }],
                dimensions: [{ key: 'status', label: 'Status', column: 'status', kind: 'string' }],
              },
            ]),
            { status: 200 },
          ),
        );
      return Promise.resolve(
        new Response(
          JSON.stringify({ columns: [], rows: [{ value: 9 }], chart: { type: 'stat', value: '9', label: 'x' }, meta: { generatedAt: 'n', rowCount: 1 } }),
          { status: 200 },
        ),
      );
    });
    const onSave = vi.fn();
    const { getByText, getByLabelText } = render(<WidgetEditorDialog open sqlEnabled={false} onClose={() => {}} onSave={onSave} />);
    await waitFor(() => expect(getByLabelText('Source')).toBeTruthy());
    fireEvent.change(getByLabelText('Title'), { target: { value: 'My KPI' } });
    fireEvent.click(getByText('Save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'My KPI', type: expect.any(String) }));
  });
});
