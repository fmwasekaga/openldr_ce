import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportCanvas } from './ReportCanvas';
import { addRowWithBlock, newBlock } from './reportBuilderModel';
import { createEmptyTemplate } from '@openldr/report-builder/pure';
import type { ReportLintIssue } from '@openldr/report-builder/pure';

function template() {
  let t = createEmptyTemplate('rt', 'R');
  t = addRowWithBlock(t, newBlock('title'));
  t = addRowWithBlock(t, newBlock('table'));
  return t;
}

describe('ReportCanvas', () => {
  it('renders an empty-state placeholder when the template has no rows', () => {
    const t = createEmptyTemplate('rt', 'R'); // no rows
    render(<ReportCanvas template={t} selected={null} onSelect={() => {}} />);
    expect(screen.getByText(/drag a block from the palette/i)).toBeInTheDocument();
  });
  it('renders a block for each cell', () => {
    render(<ReportCanvas template={template()} selected={null} onSelect={() => {}} />);
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText(/table/i)).toBeInTheDocument();
  });
  it('calls onSelect with the row/cell index when a block is clicked', () => {
    const onSelect = vi.fn();
    render(<ReportCanvas template={template()} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Title'));
    expect(onSelect).toHaveBeenCalledWith(0, 0);
  });
  it('marks the selected block', () => {
    render(<ReportCanvas template={template()} selected={{ row: 1, cell: 0 }} onSelect={() => {}} />);
    expect(screen.getByTestId('canvas-cell-1-0').getAttribute('data-selected')).toBe('true');
  });
  it('passes block data to the rendered block', () => {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('kpi'));
    const data = new Map([['0:0', { loading: true } as any]]);
    render(<ReportCanvas template={t} selected={null} onSelect={() => {}} data={data} />);
    expect(screen.getByText(/loading|…/i)).toBeInTheDocument();
  });
});

describe('ReportCanvas lint markers', () => {
  function oneBlock() {
    let t = createEmptyTemplate('rt', 'R');
    t = addRowWithBlock(t, newBlock('title'));
    return t;
  }

  it('renders an error marker on a cell with an error issue', () => {
    const issues: ReportLintIssue[] = [{ severity: 'error', code: 'empty-query', message: 'x', rowIndex: 0, cellIndex: 0 }];
    const { container } = render(<ReportCanvas template={oneBlock()} selected={null} onSelect={() => {}} issues={issues} />);
    const marker = container.querySelector('[data-testid="lint-marker-0-0"]');
    expect(marker).toBeTruthy();
    expect(marker?.className).toContain('bg-destructive');
  });

  it('renders no marker when there are no issues for a cell', () => {
    const { container } = render(<ReportCanvas template={oneBlock()} selected={null} onSelect={() => {}} issues={[]} />);
    expect(container.querySelector('[data-testid="lint-marker-0-0"]')).toBeNull();
  });
});
