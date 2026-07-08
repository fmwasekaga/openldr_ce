import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PageCanvas } from './PageCanvas';
import { MOCK_TEMPLATES } from './mockTemplates';

function pd(el: Element, x: number, y: number, extra: object = {}) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, ...extra });
}

describe('PageCanvas', () => {
  it('renders every element and the table columns', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Resistance table' })).toBeInTheDocument();
    expect(screen.getByText('Organism')).toBeInTheDocument();
  });

  it('selects an element on pointer-down and clears on empty surface', () => {
    const onSelect = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={[]} onSelect={onSelect} onCommitRects={vi.fn()} />);
    pd(screen.getByTestId('el-amr-table'), 10, 10);
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
    expect(onSelect).toHaveBeenCalledWith(['amr-table']);
    pd(screen.getByTestId('page-surface-rt-amr-summary-p1'), 5, 5);
    fireEvent.pointerUp(window, { clientX: 5, clientY: 5 });
    expect(onSelect).toHaveBeenLastCalledWith([]);
  });

  it('shift pointer-down extends the selection', () => {
    const onSelect = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title']} onSelect={onSelect} onCommitRects={vi.fn()} />);
    pd(screen.getByTestId('el-amr-table'), 10, 10, { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(['amr-title', 'amr-table']);
  });

  it('draws eight handles on a single selected element', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={['amr-table']} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    const el = screen.getByTestId('el-amr-table');
    ['nw','n','ne','e','se','s','sw','w'].forEach((h) => expect(el.querySelector(`[data-testid="handle-${h}"]`)).toBeTruthy());
  });

  it('shows no handles and outlines every element when multiple are selected', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={['amr-title', 'amr-table']} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.getByTestId('el-amr-title').className).toContain('outline');
    expect(screen.getByTestId('el-amr-table').className).toContain('outline');
    expect(screen.queryByTestId('handle-nw')).toBeNull();
  });

  it('shift-click removes an already-selected element', () => {
    const onSelect = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={['amr-title', 'amr-table']} onSelect={onSelect} onCommitRects={vi.fn()} />);
    pd(screen.getByTestId('el-amr-table'), 10, 10, { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(['amr-title']);
  });
});

describe('PageCanvas interaction', () => {
  it('commits a drag as a rect change', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-table']} onSelect={vi.fn()} onCommitRects={onCommit} />);
    const el = screen.getByTestId('el-amr-table');
    pd(el, 100, 100);
    fireEvent.pointerMove(window, { clientX: 140, clientY: 130 });
    fireEvent.pointerUp(window, { clientX: 140, clientY: 130 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const rects = onCommit.mock.calls[0][0] as Map<string, { x: number; y: number }>;
    expect(rects.get('amr-table')).toBeTruthy();
  });

  it('a plain click (no move) does not commit', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-table']} onSelect={vi.fn()} onCommitRects={onCommit} />);
    const el = screen.getByTestId('el-amr-table');
    pd(el, 100, 100);
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('resizes from a handle', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-table']} onSelect={vi.fn()} onCommitRects={onCommit} />);
    const handle = within(screen.getByTestId('el-amr-table')).getByTestId('handle-se');
    pd(handle, 0, 0);
    fireEvent.pointerMove(window, { clientX: 30, clientY: 30 });
    fireEvent.pointerUp(window, { clientX: 30, clientY: 30 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
