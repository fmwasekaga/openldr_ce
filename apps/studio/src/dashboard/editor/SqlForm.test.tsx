import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SqlForm } from './SqlForm';

describe('SqlForm', () => {
  it('emits sql changes', () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<SqlForm value={{ mode: 'sql', sql: '' }} onChange={onChange} />);
    fireEvent.change(getByLabelText('SQL'), { target: { value: 'select 1' } });
    expect(onChange).toHaveBeenCalledWith({ mode: 'sql', sql: 'select 1' });
  });
});
