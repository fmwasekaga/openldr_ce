import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InspectorPane } from './InspectorPane';

describe('InspectorPane', () => {
  it('renders children when expanded', () => {
    render(<InspectorPane collapsed={false} onToggle={() => {}}><div>PANE BODY</div></InspectorPane>);
    expect(screen.getByText('PANE BODY')).toBeInTheDocument();
  });
  it('hides children and shows an expand control when collapsed', () => {
    render(<InspectorPane collapsed onToggle={() => {}}><div>PANE BODY</div></InspectorPane>);
    expect(screen.queryByText('PANE BODY')).toBeNull();
    expect(screen.getByRole('button', { name: /expand panel/i })).toBeInTheDocument();
  });
  it('the toggle calls onToggle', () => {
    const onToggle = vi.fn();
    render(<InspectorPane collapsed onToggle={onToggle}><div>x</div></InspectorPane>);
    fireEvent.click(screen.getByRole('button', { name: /expand panel/i }));
    expect(onToggle).toHaveBeenCalled();
  });
});
