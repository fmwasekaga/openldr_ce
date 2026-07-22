import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { WidgetEditorDialog } from './WidgetEditorDialog';
import type { WidgetConfig } from '../../api';

afterEach(() => vi.restoreAllMocks());

const sqlWidget: WidgetConfig = {
  id: 'w1', type: 'kpi', title: 'K', refreshIntervalSec: 0, visual: {},
  query: { mode: 'sql', sql: 'select 42 as value' },
};

describe('WidgetEditorDialog', () => {
  // The full save flow (which routes through the Radix ⋯ menu) is covered by the
  // Playwright check; jsdom can't reliably open Radix menus. Here we smoke-test that the
  // SQL editor mounts with its core controls when opening an existing SQL-mode widget.
  it('renders the SQL editor controls', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    const { getByLabelText } = render(<WidgetEditorDialog open initial={sqlWidget} dashboardFilters={[]} onClose={() => {}} onSave={() => {}} />);
    expect(getByLabelText('Title')).toBeTruthy();
    expect(getByLabelText('SQL')).toBeTruthy();
    expect(getByLabelText('Editor menu')).toBeTruthy();
    expect(getByLabelText('Close')).toBeTruthy();
  });

  // shadcn/Radix Select can't be driven in jsdom (see BuilderForm.test.tsx); this is a render
  // smoke-test that a brand-new widget (no `initial`) defaults to Builder mode, i.e. the
  // Builder pane's Source picker is what mounts in the top-left region, not the SQL editor.
  it('defaults a new widget to Builder mode and shows the source picker', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    const { getByLabelText } = render(<WidgetEditorDialog open initial={undefined} dashboardFilters={[]} onClose={() => {}} onSave={() => {}} />);
    expect(getByLabelText('Source')).toBeInTheDocument();
  });

  it('makes the SQL field read-only when sqlEnabled is false', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    const { getByLabelText } = render(
      <WidgetEditorDialog open sqlEnabled={false} initial={sqlWidget} dashboardFilters={[]} onClose={() => {}} onSave={() => {}} />,
    );
    expect((getByLabelText('SQL') as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it('keeps the SQL field editable when sqlEnabled is true', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    const { getByLabelText } = render(
      <WidgetEditorDialog open sqlEnabled initial={sqlWidget} dashboardFilters={[]} onClose={() => {}} onSave={() => {}} />,
    );
    expect((getByLabelText('SQL') as HTMLTextAreaElement).readOnly).toBe(false);
  });

  it('previews via the stored template + values (vetted path) when sqlEnabled is false', async () => {
    const calls: any[] = [];
    const result = { columns: [{ key: 'value' }], rows: [{ value: 42 }], chart: { type: 'stat', value: '42', label: 'K' }, meta: { generatedAt: 'now', rowCount: 1 } };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
      if (String(url).includes('/api/dashboards/query')) {
        calls.push(JSON.parse(init.body));
        return new Response(JSON.stringify(result), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    render(<WidgetEditorDialog open sqlEnabled={false} initial={sqlWidget} dashboardFilters={[]} onClose={() => {}} onSave={() => {}} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    // Preview sends the STORED template verbatim (byte-identical to the persisted widget) plus a
    // `values` map — never client-substituted SQL — so the server can vet it with the flag off.
    expect(calls[0].sql).toBe('select 42 as value');
    expect(calls[0]).toHaveProperty('values');
  });
});
