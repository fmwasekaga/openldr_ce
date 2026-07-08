import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InspectorTabs } from './InspectorTabs';
import { MOCK_TEMPLATES } from './mockTemplates';

const tpl = MOCK_TEMPLATES[0];

describe('InspectorTabs', () => {
  it('shows page settings in Properties when nothing is selected', () => {
    render(<InspectorTabs template={tpl} selectedElementId={null} onSelectElement={vi.fn()} />);
    expect(screen.getByText('Page settings')).toBeInTheDocument();
    expect(screen.getByText('A4')).toBeInTheDocument();
  });

  it('shows element props in Properties when an element is selected', () => {
    render(<InspectorTabs template={tpl} selectedElementId="amr-table" onSelectElement={vi.fn()} />);
    expect(screen.getByText('Bound report')).toBeInTheDocument();
    expect(screen.getByText('AMR resistance')).toBeInTheDocument();
  });

  it('lists elements in Layers and selects one on click', () => {
    const onSelectElement = vi.fn();
    render(<InspectorTabs template={tpl} selectedElementId={null} onSelectElement={onSelectElement} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    fireEvent.click(screen.getByRole('button', { name: /Resistance table/ }));
    expect(onSelectElement).toHaveBeenCalledWith('amr-table');
  });

  it('shows bound reports and parameters in Data', () => {
    render(<InspectorTabs template={tpl} selectedElementId={null} onSelectElement={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    expect(screen.getByText('AMR resistance')).toBeInTheDocument();
    expect(screen.getByText('Facility')).toBeInTheDocument();
    expect(screen.getByText('Ndola')).toBeInTheDocument();
  });
});
