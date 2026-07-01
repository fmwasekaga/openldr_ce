import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './input';

describe('Input', () => {
  it('renders an input and forwards value/onChange', () => {
    const onChange = vi.fn();
    render(<Input aria-label="q" value="" onChange={onChange} />);
    const el = screen.getByLabelText('q');
    fireEvent.change(el, { target: { value: 'x' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('merges a custom className', () => {
    render(<Input aria-label="q" className="w-24" />);
    expect(screen.getByLabelText('q').className).toMatch(/w-24/);
  });
});
