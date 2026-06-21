import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Combobox } from './combobox';

const options = [
  { value: 'ou1', label: 'Clinic Alpha' },
  { value: 'ou2', label: 'Clinic Beta' },
];

describe('Combobox', () => {
  it('filters by query and selects an option', async () => {
    const onChange = vi.fn();
    render(<Combobox options={options} value={null} onChange={onChange} placeholder="Pick" searchPlaceholder="Search" />);
    fireEvent.click(screen.getByRole('button', { name: /pick/i }));
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'beta' } });
    expect(screen.queryByText('Clinic Alpha')).toBeNull();
    fireEvent.click(screen.getByText('Clinic Beta'));
    expect(onChange).toHaveBeenCalledWith('ou2');
  });

  it('shows the selected label on the trigger', () => {
    render(<Combobox options={options} value="ou1" onChange={() => {}} placeholder="Pick" searchPlaceholder="Search" />);
    expect(screen.getByRole('button', { name: /clinic alpha/i })).toBeTruthy();
  });
});
