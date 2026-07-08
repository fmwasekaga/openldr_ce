import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PropertiesTab } from './PropertiesTab';
import { MOCK_TEMPLATES } from './mockTemplates';

const tpl = MOCK_TEMPLATES[0];
function setup(overrides = {}) {
  const props = { template: tpl, selectedIds: [] as string[], onPatchElement: vi.fn(), onPatchPage: vi.fn(), ...overrides };
  render(<PropertiesTab {...props} />);
  return props;
}

describe('PropertiesTab editing', () => {
  it('shows page settings and edits a margin when nothing is selected', () => {
    const props = setup({ selectedIds: [] });
    expect(screen.getByText('Page settings')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Margin top'), { target: { value: '12' } });
    expect(props.onPatchPage).toHaveBeenCalledWith(expect.objectContaining({ margins: expect.objectContaining({ top: 12 }) }));
  });

  it('edits X of a selected element (clamped, coalesced)', () => {
    const props = setup({ selectedIds: ['amr-title'] });
    fireEvent.change(screen.getByLabelText('X'), { target: { value: '100' } });
    expect(props.onPatchElement).toHaveBeenCalledWith('amr-title', expect.objectContaining({ rect: expect.objectContaining({ x: 100 }) }));
  });

  it('shows the count for a multi-selection', () => {
    setup({ selectedIds: ['amr-title', 'amr-table'] });
    expect(screen.getByText('2 elements selected')).toBeInTheDocument();
  });

  it('clamps W to the minimum when a too-small value is typed', () => {
    const props = setup({ selectedIds: ['amr-title'] });
    fireEvent.change(screen.getByLabelText('W'), { target: { value: '0' } });
    const call = props.onPatchElement.mock.calls.at(-1)!;
    expect(call[1].rect.w).toBe(8);
  });

  it('edits text content (coalesced) and toggles bold (discrete)', () => {
    const props = setup({ selectedIds: ['amr-title'] });
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'New title' } });
    expect(props.onPatchElement).toHaveBeenCalledWith('amr-title', { text: 'New title' }, undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(props.onPatchElement).toHaveBeenCalledWith('amr-title', { style: { bold: true } }, { discrete: true });
  });

  it('adds a table column (discrete)', () => {
    const props = setup({ selectedIds: ['amr-table'] });
    fireEvent.click(screen.getByRole('button', { name: /add column/i }));
    expect(props.onPatchElement).toHaveBeenCalledWith('amr-table', expect.objectContaining({ columns: expect.any(Array) }), { discrete: true });
  });
});
