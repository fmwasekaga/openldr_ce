import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TemplatesExplorer } from './TemplatesExplorer';
import { MOCK_TEMPLATES } from './mockTemplates';

function setup(overrides = {}) {
  const props = { templates: MOCK_TEMPLATES, selectedId: MOCK_TEMPLATES[0].id, onSelect: vi.fn(), onCollapse: vi.fn(), ...overrides };
  render(<TemplatesExplorer {...props} />);
  return props;
}

describe('TemplatesExplorer', () => {
  it('renders the header label and every template name', () => {
    setup();
    expect(screen.getByText('Templates')).toBeInTheDocument();
    expect(screen.getByText('AMR summary')).toBeInTheDocument();
    expect(screen.getByText('Monthly caseload')).toBeInTheDocument();
    expect(screen.getByText('Lab TAT')).toBeInTheDocument();
  });

  it('calls onSelect with the template id when a card is clicked', () => {
    const props = setup();
    fireEvent.click(screen.getByText('Lab TAT'));
    expect(props.onSelect).toHaveBeenCalledWith('rt-lab-tat');
  });

  it('calls onCollapse from the collapse control', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /collapse explorer/i }));
    expect(props.onCollapse).toHaveBeenCalled();
  });
});
