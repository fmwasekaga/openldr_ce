import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TypeToConfirmDialog } from './type-to-confirm-dialog';

describe('TypeToConfirmDialog', () => {
  it('enables confirm only when the typed phrase matches', () => {
    const onConfirm = vi.fn();
    render(<TypeToConfirmDialog open title="Change" body="type it" confirmPhrase="medium"
      confirmLabel="Apply" onConfirm={onConfirm} onOpenChange={() => {}} />);
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'medium' } });
    expect(apply).not.toBeDisabled();
    fireEvent.click(apply);
    expect(onConfirm).toHaveBeenCalled();
  });
});
