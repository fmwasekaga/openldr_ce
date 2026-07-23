import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { JoinColumnPicker, adhocKey } from './JoinColumnPicker';

const optionalJoins = [
  { alias: 'jp', label: 'Patient', exposableColumns: ['sex', 'managing_organization'] },
];

describe('adhocKey', () => {
  it('builds a stable join__column key', () => {
    expect(adhocKey('jp', 'sex')).toBe('jp__sex');
  });
});

describe('JoinColumnPicker', () => {
  it('emits an AdhocDimension with a default label when confirmed', () => {
    const onAdd = vi.fn();
    render(<JoinColumnPicker optionalJoins={optionalJoins} onAdd={onAdd} onCancel={() => {}} />);
    // The single optional join ('jp') is preselected, so we only need to pick the column.
    // Radix Select is a combobox (not a native <select>): open the menu by clicking the
    // trigger, then click the option by its role. The setupTests.ts pointer-capture +
    // scrollIntoView polyfills make this work under jsdom.
    fireEvent.click(screen.getByLabelText('Column'));
    fireEvent.click(screen.getByRole('option', { name: 'sex' }));

    fireEvent.click(screen.getByRole('button', { name: /add column/i }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'jp__sex',
        join: 'jp',
        column: 'sex',
        kind: 'string',
        label: expect.any(String),
      }),
    );
    expect(onAdd.mock.calls[0][0].label).not.toBe('');
  });
});
