import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Switch } from './switch';

describe('Switch', () => {
  it('toggles via onCheckedChange and reflects aria-checked', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="enabled" />);
    const sw = screen.getByRole('switch', { name: 'enabled' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
