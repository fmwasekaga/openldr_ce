import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageCanvas } from './PageCanvas';
import { MOCK_TEMPLATES } from './mockTemplates';

describe('PageCanvas', () => {
  it('renders every element and the table columns', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={[]} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Resistance table' })).toBeInTheDocument();
    expect(screen.getByText('Organism')).toBeInTheDocument();
  });

  it('selects an element on click and clears on backdrop click', () => {
    const onSelect = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={[]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resistance table' }));
    expect(onSelect).toHaveBeenCalledWith(['amr-table']);
    fireEvent.click(screen.getByTestId('page-canvas'));
    expect(onSelect).toHaveBeenLastCalledWith([]);
  });

  it('shift-click extends the selection', () => {
    const onSelect = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={['amr-title']} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resistance table' }), { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(['amr-title', 'amr-table']);
  });

  it('draws eight handles on a single selected element', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedIds={['amr-table']} onSelect={vi.fn()} />);
    const el = screen.getByTestId('el-amr-table');
    ['nw','n','ne','e','se','s','sw','w'].forEach((h) => expect(el.querySelector(`[data-testid="handle-${h}"]`)).toBeTruthy());
  });
});
