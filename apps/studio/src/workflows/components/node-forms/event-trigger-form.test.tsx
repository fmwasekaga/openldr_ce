import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EventTriggerForm } from './event-trigger-form';

// Radix Select is awkward in jsdom; render it as a native <select> for this test.
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value?: string; onValueChange?: (v: string) => void }) => (
    <select role="combobox" value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)}>{children}</select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

const node = { id: 'e1', type: 'trigger', data: { label: 'Event Trigger', triggerType: 'event', config: { event: 'data.persisted', source: '', resourceType: '' } } } as never;

describe('EventTriggerForm', () => {
  it('renders the event select and the source + resource type filters', () => {
    render(<EventTriggerForm node={node} update={vi.fn()} />);
    expect(screen.getByText('Event')).toBeInTheDocument();
    expect(screen.getByText('Source filter')).toBeInTheDocument();
    expect(screen.getByText('Resource type filter')).toBeInTheDocument();
  });

  it('writes config.source when the source filter changes', () => {
    const update = vi.fn();
    render(<EventTriggerForm node={node} update={update} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[1], { target: { value: 'demo-lab' } });
    expect(update).toHaveBeenCalledWith({ config: { event: 'data.persisted', source: 'demo-lab', resourceType: '' } });
  });

  it('writes config.resourceType when the resource type filter changes', () => {
    const update = vi.fn();
    render(<EventTriggerForm node={node} update={update} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[2], { target: { value: 'Observation' } });
    expect(update).toHaveBeenCalledWith({ config: { event: 'data.persisted', source: '', resourceType: 'Observation' } });
  });
});
