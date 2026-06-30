import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RunDetail } from './run-history-drawer';

// CodeMirror (JsonView) is awkward in jsdom — render it as a textarea showing the value.
vi.mock('../node-forms/code-editor', () => ({
  CodeEditor: ({ value }: { value: string }) => <textarea data-testid="json" readOnly value={value} />,
}));

const mkRun = (results: unknown[]) => ({
  id: 'r1', triggerSource: 'event' as const, status: 'completed' as const,
  startedAt: '2026-06-30T00:00:00.000Z', finishedAt: '2026-06-30T00:00:01.000Z', error: null,
  result: { status: 'completed', results },
}) as never;

const run = mkRun([
  { nodeId: 'sql-1', label: 'Query batch rows', type: 'action', status: 'success', durationMs: 5,
    output: [{ json: { batchId: 'b1' } }], meta: { persisted: 1 }, logs: [] },
  { nodeId: 'log-1', label: 'Log', type: 'action', status: 'success', durationMs: 0,
    output: [{ json: { ok: true } }], meta: undefined, logs: [{ level: 'log', message: 'batch rows: 1', ts: 1 }] },
]);

describe('RunDetail master-detail', () => {
  it('shows node labels (not just ids) in the table', () => {
    render(<RunDetail run={run} loading={false} />);
    expect(screen.getByText('Query batch rows')).toBeInTheDocument();
    expect(screen.getByText('Log')).toBeInTheDocument();
  });

  it('auto-selects the first node and shows its output', () => {
    render(<RunDetail run={run} loading={false} />);
    const text = screen.getAllByTestId('json').map((v) => (v as HTMLTextAreaElement).value).join('\n');
    expect(text).toContain('batchId');
    expect(text).toContain('b1');
  });

  it('selecting a node shows its output and its logs tab', () => {
    render(<RunDetail run={run} loading={false} />);
    fireEvent.click(screen.getByText('Log'));
    expect(screen.getAllByTestId('json').map((v) => (v as HTMLTextAreaElement).value).join('\n')).toContain('ok');
    fireEvent.click(screen.getByRole('button', { name: /logs/i }));
    expect(screen.getByText('batch rows: 1')).toBeInTheDocument();
  });

  it('auto-selects a failed node and its Result tab shows its meta', () => {
    const failRun = mkRun([
      { nodeId: 'a', label: 'Node A', type: 'action', status: 'success', durationMs: 1, output: [{ json: { a: 1 } }], logs: [] },
      { nodeId: 'b', label: 'Node B', type: 'action', status: 'error', durationMs: 1, error: 'boom', output: undefined, meta: { tried: true }, logs: [] },
    ]);
    render(<RunDetail run={failRun} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /result/i }));
    const ta = screen.getByTestId('json') as HTMLTextAreaElement;
    expect(ta.value).toContain('tried');
  });
});
