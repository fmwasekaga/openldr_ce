import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RunDetail } from './run-history-drawer';

// CodeMirror (used by JsonView) is awkward in jsdom — render it as a textarea
// that shows the value so we can assert on the JSON text.
vi.mock('../node-forms/code-editor', () => ({
  CodeEditor: ({ value }: { value: string }) => <textarea data-testid="json" readOnly value={value} />,
}));

const run = {
  id: 'r1',
  triggerSource: 'event' as const,
  status: 'completed' as const,
  startedAt: '2026-06-30T00:00:00.000Z',
  finishedAt: '2026-06-30T00:00:01.000Z',
  error: null,
  result: {
    status: 'completed',
    results: [
      { nodeId: 'sql-1', type: 'action', status: 'success', durationMs: 5,
        output: [{ json: { batchId: 'b1' } }], meta: { persisted: 1 } },
    ],
  },
} as never;

describe('RunDetail per-node inspector', () => {
  it('renders the event trigger source', () => {
    render(<RunDetail run={run} loading={false} />);
    expect(screen.getByText('event')).toBeInTheDocument();
  });

  it('expands a node row to show its output and meta JSON', () => {
    render(<RunDetail run={run} loading={false} />);
    expect(screen.queryByTestId('json')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('sql-1'));
    const viewers = screen.getAllByTestId('json');
    const text = viewers.map((v) => (v as HTMLTextAreaElement).value).join('\n');
    expect(text).toContain('batchId');
    expect(text).toContain('b1');
    expect(text).toContain('persisted');
  });
});
