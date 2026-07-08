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
});
