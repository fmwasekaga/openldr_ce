import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CustomColumnEditor } from './CustomColumnEditor';

const dims = [
  { key: 'status', label: 'Status', kind: 'string' as const },
  { key: 'priority', label: 'Priority', kind: 'string' as const },
  { key: 'nv', label: 'Numeric Value', kind: 'number' as const },
];

describe('CustomColumnEditor', () => {
  it('renders the operation select and a concat operand row by default', () => {
    render(<CustomColumnEditor dims={dims} existing={[]} onAdd={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText('Operation')).toBeInTheDocument();
    expect(screen.getByLabelText('Operand type')).toBeInTheDocument();
  });

  it('shows an operator select after switching to Arithmetic', () => {
    render(<CustomColumnEditor dims={dims} existing={[]} onAdd={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByLabelText('Operation'));
    fireEvent.click(screen.getByRole('option', { name: /arithmetic/i }));
    expect(screen.getByLabelText('Operator')).toBeInTheDocument();
  });

  it('emits a concat custom column built from a chosen field', () => {
    const onAdd = vi.fn();
    render(<CustomColumnEditor dims={dims} existing={[]} onAdd={onAdd} onCancel={() => {}} />);
    // The default operand type is 'field'; pick 'Status' via the real Radix Select.
    fireEvent.click(screen.getByLabelText('Operand field'));
    fireEvent.click(screen.getByRole('option', { name: 'Status' }));
    fireEvent.click(screen.getByRole('button', { name: /add column/i }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      key: 'custom',
      label: 'Status',
      expr: { kind: 'concat', parts: [{ type: 'field', dimension: 'status' }] },
    }));
  });

  it('disables "Add column" until every field operand is chosen', () => {
    render(<CustomColumnEditor dims={dims} existing={[]} onAdd={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: /add column/i })).toBeDisabled(); // default field is empty
    fireEvent.click(screen.getByLabelText('Operand field'));
    fireEvent.click(screen.getByRole('option', { name: 'Status' }));
    expect(screen.getByRole('button', { name: /add column/i })).toBeEnabled();
  });

  it('arithmetic operands offer only numeric fields', () => {
    render(<CustomColumnEditor dims={dims} existing={[]} onAdd={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByLabelText('Operation'));
    fireEvent.click(screen.getByRole('option', { name: /arithmetic/i }));
    // left operand defaults to type 'field'; open its field select (there are two "Operand field" selects — use the first)
    fireEvent.click(screen.getAllByLabelText('Operand field')[0]);
    expect(screen.getByRole('option', { name: 'Numeric Value' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Status' })).not.toBeInTheDocument();
  });
});
