import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportCanvas } from './ReportCanvas';
import { addRowWithBlock, newBlock } from './reportBuilderModel';
import { createEmptyTemplate } from '@openldr/report-builder/pure';

function template() {
  let t = createEmptyTemplate('rt', 'R');
  t = addRowWithBlock(t, newBlock('title'));
  t = addRowWithBlock(t, newBlock('table'));
  return t;
}

describe('ReportCanvas', () => {
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
});
