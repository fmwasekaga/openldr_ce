import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
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

  // SQL -> Builder import guard: unrecognizable SQL (a UNION here) must not silently drop into
  // the builder pane with a wrong/partial query — the toggle disables and the refusal reason
  // (from @openldr/dashboards' recognizeSql) is shown inline so the test can assert it without
  // depending on the sonner toast portal being present in the jsdom tree.
  it('disables the Builder toggle for unrecognizable SQL and shows a reason', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    const initial = {
      id: 'w1', type: 'kpi', title: 't', refreshIntervalSec: 0, visual: {},
      query: { mode: 'sql', sql: 'SELECT a, b FROM lab_requests UNION SELECT c, d FROM specimens' },
    } as const;
    render(<WidgetEditorDialog open initial={initial as any} onClose={() => {}} onSave={() => {}} />);
    const builderBtn = screen.getByRole('button', { name: 'Builder' });
    fireEvent.click(builderBtn);
    expect(screen.getByRole('button', { name: 'Builder' })).toBeDisabled();
    // The refusal reason is rendered as an inline `role="alert"` element next to the toggle (not
    // only fired as a sonner toast, whose portal may not be present in the jsdom tree). Scoped to
    // `role="alert"` rather than a plain text query, since the SQL itself (rendered by CodeMirror
    // in the editor pane) also literally contains the word "UNION".
    expect(screen.getByRole('alert')).toHaveTextContent(/UNION/i);
  });

  // SQL -> Builder import guard: recognizable SQL imports into the builder query and switches
  // panes. The recognizer's field-level correctness is already covered by recognize-sql.test.ts's
  // corpus test; here we only assert the Builder pane (a shadcn Select whose .value jsdom can't
  // read) actually mounted and the toggle stayed enabled.
  it('imports recognizable SQL into the builder', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    const initial = {
      id: 'w2', type: 'bar-chart', title: 't', refreshIntervalSec: 0, visual: {},
      query: { mode: 'sql', sql: 'SELECT status AS label, COUNT(*) AS value FROM lab_requests GROUP BY status' },
    } as const;
    render(<WidgetEditorDialog open initial={initial as any} onClose={() => {}} onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Builder' }));
    expect(screen.getByLabelText('Source')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Builder' })).not.toBeDisabled();
  });

  // NOTE: a dedicated test for the "no measure" empty-panel text (see WidgetEditorDialog.tsx's
  // `builderHasNoMeasure`) is not included here. Rendering a builder query with an absent `metric`
  // (the documented no-measure shape from WidgetQuerySchema) crashes BuilderForm today: its `shown`
  // state seeds from `measuresOf(value).length` (builderForm.model.ts), which is always >= 1 even
  // with no measure (measuresOf falls back to `[value.metric]`, i.e. `[undefined]`) — so the
  // Summarize section mounts MeasuresEditor with `[undefined]`, and MeasuresEditor's
  // aggregateMeasures() throws on `undefined.derived`. That's a pre-existing bug outside this
  // task's scope (WidgetEditorDialog.tsx only); flagged separately rather than fixed/mocked-around
  // here.
});
