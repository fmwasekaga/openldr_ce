import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorField } from './ColorField';

describe('ColorField', () => {
  it('emits a typed hex value', () => {
    const onChange = vi.fn();
    render(<ColorField value="#000000" onChange={onChange} aria-label="Text color" />);
    fireEvent.change(screen.getByLabelText('Text color hex'), { target: { value: '#ff0000' } });
    expect(onChange).toHaveBeenCalledWith('#ff0000');
  });

  it('emits a preset when a swatch is chosen', () => {
    const onChange = vi.fn();
    render(<ColorField value="#000000" onChange={onChange} aria-label="Text color" />);
    const trigger = screen.getByRole('button', { name: 'Text color' });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    if (!screen.queryByRole('button', { name: '#ef4444' })) fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: '#ef4444' }));
    expect(onChange).toHaveBeenCalledWith('#ef4444');
  });
});
