import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PageCanvas } from './PageCanvas';
import { MOCK_TEMPLATES } from './mockTemplates';
import type { ReportTemplate } from './types';

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

  it('marquee-drag selects the intersecting elements', () => {
    const onSelect = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={[]} onSelect={onSelect} onCommitRects={vi.fn()} />);
    const surface = screen.getByTestId('page-surface-rt-amr-summary-p1');
    fireEvent.pointerDown(surface, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(window, { clientX: 700, clientY: 700 });
    fireEvent.pointerUp(window, { clientX: 700, clientY: 700 });
    const ids = onSelect.mock.calls.at(-1)![0];
    expect(ids).toEqual(expect.arrayContaining(['amr-title', 'amr-table']));
  });

  it('drags a multi-selection and commits all their rects', () => {
    const onCommit = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-title', 'amr-subtitle']} onSelect={vi.fn()} onCommitRects={onCommit} />);
    fireEvent.pointerDown(screen.getByTestId('el-amr-title'), { clientX: 50, clientY: 45, button: 0 });
    fireEvent.pointerMove(window, { clientX: 90, clientY: 75 });
    fireEvent.pointerUp(window, { clientX: 90, clientY: 75 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const rects = onCommit.mock.calls[0][0];
    expect(rects.has('amr-title')).toBe(true);
    expect(rects.has('amr-subtitle')).toBe(true);
  });

  it('renders an alignment guide when a drag snaps into alignment', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={1} selectedIds={['amr-footer']} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    // amr-footer starts at x=48 (aligned with title/subtitle/table left edges). Nudge +3 so its
    // left edge (51) is within the 6px snap threshold of x=48 → an x-guide should render.
    fireEvent.pointerDown(screen.getByTestId('el-amr-footer'), { clientX: 60, clientY: 1065, button: 0 });
    fireEvent.pointerMove(window, { clientX: 63, clientY: 1065 });
    expect(screen.getByTestId('guide')).toBeInTheDocument();
    fireEvent.pointerUp(window, { clientX: 63, clientY: 1065 });
  });
});

function tplWith(el: Partial<import('./types').DesignElement> & { id: string; kind: import('./types').ElementKind }, margins?: import('./types').Margins): ReportTemplate {
  return { id: 't', name: 't', paper: 'A4', orientation: 'portrait', parameters: [], margins,
    pages: [{ id: 'p1', elements: [{ name: el.id, rect: { x: 10, y: 10, w: 100, h: 40 }, ...el }] }] };
}

describe('PageCanvas style rendering', () => {
  it('renders a bold, colored, sized text element', () => {
    render(<PageCanvas template={tplWith({ id: 'tx', kind: 'text', text: 'Hi', style: { bold: true, fontSize: 20, color: '#ff0000', align: 'center' } })}
      zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    const box = screen.getByText('Hi');
    expect(box).toHaveStyle({ fontWeight: '600', textAlign: 'center', fontSize: '20px', color: 'rgb(255, 0, 0)' });
  });

  it('renders an image element with a src', () => {
    render(<PageCanvas template={tplWith({ id: 'im', kind: 'image', src: 'http://x/y.png' })}
      zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://x/y.png');
  });

  it('renders a page margin guide when margins are set', () => {
    render(<PageCanvas template={tplWith({ id: 'tx', kind: 'text', text: 'Hi' }, { top: 20, right: 20, bottom: 20, left: 20 })}
      zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.getByTestId('margin-guide')).toHaveStyle({ left: '20px', top: '20px', right: '20px', bottom: '20px' });
  });

  it('renders no margin guide when margins are unset', () => {
    render(<PageCanvas template={tplWith({ id: 'tx', kind: 'text', text: 'Hi' })}
      zoom={1} selectedIds={[]} onSelect={vi.fn()} onCommitRects={vi.fn()} />);
    expect(screen.queryByTestId('margin-guide')).toBeNull();
  });
});
