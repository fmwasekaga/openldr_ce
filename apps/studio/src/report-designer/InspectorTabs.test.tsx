import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InspectorTabs } from './InspectorTabs';
import { MOCK_TEMPLATES } from './mockTemplates';

const tpl = MOCK_TEMPLATES[0];

describe('InspectorTabs', () => {
  it('shows page settings in Properties when nothing is selected', () => {
    render(<InspectorTabs template={tpl} selectedIds={[]} onSelect={vi.fn()} onPatchElement={vi.fn()} onPatchPage={vi.fn()} onPatchElements={vi.fn()} onPatchParameters={vi.fn()} />);
    expect(screen.getByText('Page settings')).toBeInTheDocument();
    expect(screen.getByText('A4')).toBeInTheDocument();
  });

  it('shows element props in Properties when an element is selected', () => {
    render(<InspectorTabs template={tpl} selectedIds={['amr-table']} onSelect={vi.fn()} onPatchElement={vi.fn()} onPatchPage={vi.fn()} onPatchElements={vi.fn()} onPatchParameters={vi.fn()} />);
    expect(screen.getByText('Position and size')).toBeInTheDocument();
    expect(screen.getByLabelText('X')).toHaveValue(tpl.pages[0].elements.find((e) => e.id === 'amr-table')!.rect.x);
  });

  it('lists elements in Layers and selects one on click', () => {
    const onSelect = vi.fn();
    render(<InspectorTabs template={tpl} selectedIds={[]} onSelect={onSelect} onPatchElement={vi.fn()} onPatchPage={vi.fn()} onPatchElements={vi.fn()} onPatchParameters={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    fireEvent.click(screen.getByRole('button', { name: /Resistance table/ }));
    expect(onSelect).toHaveBeenCalledWith(['amr-table']);
  });

  it('prompts to select a table in Data when nothing is selected', () => {
    render(<InspectorTabs template={tpl} selectedIds={[]} onSelect={vi.fn()} onPatchElement={vi.fn()} onPatchPage={vi.fn()} onPatchElements={vi.fn()} onPatchParameters={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    expect(screen.getByText(/select a table/i)).toBeInTheDocument();
  });

  it('shows the query binding UI in Data when a table is selected', () => {
    render(<InspectorTabs template={tpl} selectedIds={['amr-table']} onSelect={vi.fn()} onPatchElement={vi.fn()} onPatchPage={vi.fn()} onPatchElements={vi.fn()} onPatchParameters={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    expect(screen.getByLabelText('Bind query')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load columns/i })).toBeInTheDocument();
  });

  it('shift-click in Layers toggles an element into the selection', () => {
    const onSelect = vi.fn();
    render(<InspectorTabs template={tpl} selectedIds={['amr-title']} onSelect={onSelect} onPatchElement={vi.fn()} onPatchPage={vi.fn()} onPatchElements={vi.fn()} onPatchParameters={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    fireEvent.click(screen.getByRole('button', { name: /Resistance table/ }), { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(['amr-title', 'amr-table']);
  });

  it('Properties shows a count when multiple elements are selected', () => {
    render(<InspectorTabs template={tpl} selectedIds={['amr-title', 'amr-table']} onSelect={vi.fn()} onPatchElement={vi.fn()} onPatchPage={vi.fn()} onPatchElements={vi.fn()} onPatchParameters={vi.fn()} />);
    expect(screen.getByText('2 elements selected')).toBeInTheDocument();
  });
});
