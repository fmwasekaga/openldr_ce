import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ReadWriteFileForm } from './read-write-file-form';

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

const node = (config: Record<string, unknown> = {}) =>
  ({ id: 'f', type: 'action', data: { label: 'x', action: 'read-write-file', config } } as never);

describe('ReadWriteFileForm', () => {
  it('writes the path', () => {
    const update = vi.fn();
    const { getByPlaceholderText } = render(<ReadWriteFileForm node={node({ operation: 'read' })} update={update} />);
    fireEvent.change(getByPlaceholderText(/path/i), { target: { value: 'sub/a.txt' } });
    expect(update).toHaveBeenCalledWith({ config: expect.objectContaining({ path: 'sub/a.txt' }) });
  });

  it('shows asText checkbox and binaryField input for read operation', () => {
    const { getByRole, getByPlaceholderText } = render(
      <ReadWriteFileForm node={node({ operation: 'read' })} update={vi.fn()} />,
    );
    expect(getByRole('checkbox')).toBeInTheDocument();
    expect(getByPlaceholderText(/output field/i)).toBeInTheDocument();
  });

  it('shows binaryField and textContent inputs for write operation', () => {
    const { getByPlaceholderText } = render(
      <ReadWriteFileForm node={node({ operation: 'write' })} update={vi.fn()} />,
    );
    expect(getByPlaceholderText(/text content/i)).toBeInTheDocument();
  });

  it('writes config.operation when the operation select changes', () => {
    const update = vi.fn();
    const { getByRole } = render(<ReadWriteFileForm node={node({ operation: 'read' })} update={update} />);
    fireEvent.change(getByRole('combobox'), { target: { value: 'write' } });
    expect(update).toHaveBeenCalledWith({ config: expect.objectContaining({ operation: 'write' }) });
  });

  it('writes asText when checkbox toggled', () => {
    const update = vi.fn();
    const { getByRole } = render(<ReadWriteFileForm node={node({ operation: 'read' })} update={update} />);
    fireEvent.click(getByRole('checkbox'));
    expect(update).toHaveBeenCalledWith({ config: expect.objectContaining({ asText: true }) });
  });
});
