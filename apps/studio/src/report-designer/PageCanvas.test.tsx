import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PageCanvas } from './PageCanvas';
import { MOCK_TEMPLATES } from './mockTemplates';

describe('PageCanvas', () => {
  it('renders every element on the page and the table columns', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedElementId={null} onSelectElement={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Resistance table' })).toBeInTheDocument();
    expect(screen.getByText('Organism')).toBeInTheDocument();
    expect(screen.getByText('E. coli')).toBeInTheDocument();
  });

  it('selects an element on click and deselects on backdrop click', () => {
    const onSelectElement = vi.fn();
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedElementId={null} onSelectElement={onSelectElement} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resistance table' }));
    expect(onSelectElement).toHaveBeenCalledWith('amr-table');
    fireEvent.click(screen.getByTestId('page-canvas'));
    expect(onSelectElement).toHaveBeenLastCalledWith(null);
  });

  it('draws four selection handles on the selected element', () => {
    render(<PageCanvas template={MOCK_TEMPLATES[0]} zoom={0.75} selectedElementId="amr-table" onSelectElement={vi.fn()} />);
    const el = screen.getByTestId('el-amr-table');
    expect(within(el).getAllByTestId('handle')).toHaveLength(4);
  });
});
