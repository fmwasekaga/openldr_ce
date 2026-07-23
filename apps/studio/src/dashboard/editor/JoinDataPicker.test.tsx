import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { JoinDataPicker } from './JoinDataPicker';

const optionalJoins = [
  { alias: 'js', label: 'Specimen', left: 'specimen_id', right: 'id', exposableColumns: ['status', 'origin'] },
];

describe('JoinDataPicker', () => {
  it('shows the read-only join keys for the selected relationship', () => {
    render(<JoinDataPicker optionalJoins={optionalJoins} adhoc={[]} onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('on specimen_id = id')).toBeInTheDocument();
  });

  it('applies the checked columns for the selected relationship', () => {
    const onApply = vi.fn();
    render(<JoinDataPicker optionalJoins={optionalJoins} adhoc={[]} onApply={onApply} onCancel={() => {}} />);
    fireEvent.click(screen.getByLabelText('status')); // check the column
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    expect(onApply).toHaveBeenCalledWith('js', 'Specimen', ['status']);
  });

  it('pre-checks columns already present for the relationship', () => {
    const adhoc = [{ key: 'js__origin', label: 'Specimen → Origin', join: 'js', column: 'origin', kind: 'string' as const }];
    render(<JoinDataPicker optionalJoins={optionalJoins} adhoc={adhoc} onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText('origin')).toBeChecked();
    expect(screen.getByLabelText('status')).not.toBeChecked();
  });
});
