import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DashboardFilterBar } from './DashboardFilterBar';

describe('DashboardFilterBar', () => {
  it('emits value changes', () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<DashboardFilterBar filters={[{ id: 'f1', label: 'Status', type: 'text' }]} values={{}} onChange={onChange} />);
    fireEvent.change(getByLabelText('Status'), { target: { value: 'active' } });
    expect(onChange).toHaveBeenCalledWith({ f1: 'active' });
  });
});
