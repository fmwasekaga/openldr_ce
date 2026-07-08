import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InspectorTabs } from './InspectorTabs';
import { MOCK_TEMPLATES } from './mockTemplates';

const tpl = MOCK_TEMPLATES[0];

describe('InspectorTabs', () => {
  it('shows page settings in Properties when nothing is selected', () => {
    render(<InspectorTabs template={tpl} selectedIds={[]} onSelect={vi.fn()} />);
    expect(screen.getByText('Page settings')).toBeInTheDocument();
    expect(screen.getByText('A4')).toBeInTheDocument();
  });

  it('shows element props in Properties when an element is selected', () => {
    render(<InspectorTabs template={tpl} selectedIds={['amr-table']} onSelect={vi.fn()} />);
    expect(screen.getByText('Bound report')).toBeInTheDocument();
    expect(screen.getByText('AMR resistance')).toBeInTheDocument();
  });

  it('lists elements in Layers and selects one on click', () => {
    const onSelect = vi.fn();
    render(<InspectorTabs template={tpl} selectedIds={[]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    fireEvent.click(screen.getByRole('button', { name: /Resistance table/ }));
    expect(onSelect).toHaveBeenCalledWith(['amr-table']);
  });

  it('shows bound reports and parameters in Data', () => {
    render(<InspectorTabs template={tpl} selectedIds={[]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    expect(screen.getByText('AMR resistance')).toBeInTheDocument();
    expect(screen.getByText('Facility')).toBeInTheDocument();
    expect(screen.getByText('Ndola')).toBeInTheDocument();
  });

  it('shift-click in Layers toggles an element into the selection', () => {
    const onSelect = vi.fn();
    render(<InspectorTabs template={tpl} selectedIds={['amr-title']} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    fireEvent.click(screen.getByRole('button', { name: /Resistance table/ }), { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(['amr-title', 'amr-table']);
  });

  it('Properties shows a count when multiple elements are selected', () => {
    render(<InspectorTabs template={tpl} selectedIds={['amr-title', 'amr-table']} onSelect={vi.fn()} />);
    expect(screen.getByText('2 elements selected')).toBeInTheDocument();
  });
});
