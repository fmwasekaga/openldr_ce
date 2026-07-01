import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PostgresTriggerForm } from './postgres-trigger-form';
import { EmailTriggerForm } from './email-trigger-form';

// The connector picker fetches options on mount via fetchNodeOptions('connectors:<type>').
// Stub it so the plain-input assertions below don't depend on the network.
vi.mock('@/api', () => ({ fetchNodeOptions: vi.fn().mockResolvedValue([]) }));

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

const node = (config: Record<string, unknown> = {}, triggerType = 'postgres') =>
  ({ id: 't', type: 'trigger', data: { label: 'x', triggerType, config } } as never);

describe('listener trigger forms', () => {
  it('postgres form writes the channel', () => {
    const update = vi.fn();
    const { getByPlaceholderText } = render(<PostgresTriggerForm node={node()} update={update} />);
    fireEvent.change(getByPlaceholderText(/channel/i), { target: { value: 'my_ch' } });
    expect(update).toHaveBeenCalledWith({ config: expect.objectContaining({ channel: 'my_ch' }) });
  });

  it('email form writes pollSeconds', () => {
    const update = vi.fn();
    const { getByRole } = render(<EmailTriggerForm node={node({ folder: 'INBOX' }, 'email')} update={update} />);
    fireEvent.change(getByRole('spinbutton'), { target: { value: '90' } });
    expect(update).toHaveBeenCalledWith({ config: expect.objectContaining({ pollSeconds: 90 }) });
  });
});
