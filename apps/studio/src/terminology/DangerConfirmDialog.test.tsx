import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DangerConfirmDialog } from './DangerConfirmDialog';

describe('DangerConfirmDialog', () => {
  it('enables the action only after the exact name is typed', () => {
    const onConfirm = vi.fn();
    render(
      <DangerConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete X"
        confirmName="LOINC"
        confirmLabel="Delete"
        summary={<span>2 terms</span>}
        onConfirm={onConfirm}
      />,
    );

    const action = screen.getByRole('button', { name: 'Delete' });
    expect(action).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Confirm name' }), {
      target: { value: 'LOINC' },
    });
    expect(action).not.toBeDisabled();

    fireEvent.click(action);
    expect(onConfirm).toHaveBeenCalled();
  });

  it('stays disabled when the typed value does not match', () => {
    render(
      <DangerConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete X"
        confirmName="LOINC"
        confirmLabel="Delete"
        summary="This will be removed."
        onConfirm={vi.fn()}
      />,
    );

    const action = screen.getByRole('button', { name: 'Delete' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Confirm name' }), {
      target: { value: 'loinc' },
    });
    expect(action).toBeDisabled();
  });

  it('resets the input when reopened', () => {
    const { rerender } = render(
      <DangerConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete X"
        confirmName="LOINC"
        confirmLabel="Delete"
        summary="desc"
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Confirm name' }), {
      target: { value: 'LOINC' },
    });
    expect(screen.getByRole('textbox', { name: 'Confirm name' })).toHaveValue('LOINC');

    // Close then reopen
    rerender(
      <DangerConfirmDialog
        open={false}
        onOpenChange={() => {}}
        title="Delete X"
        confirmName="LOINC"
        confirmLabel="Delete"
        summary="desc"
        onConfirm={vi.fn()}
      />,
    );
    rerender(
      <DangerConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete X"
        confirmName="LOINC"
        confirmLabel="Delete"
        summary="desc"
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Confirm name' })).toHaveValue('');
  });

  it('shows a busy state while an async onConfirm runs, blocking the action and cancel', async () => {
    let resolveConfirm!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => { resolveConfirm = r; }));
    render(
      <DangerConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete X"
        confirmName="LOINC"
        confirmLabel="Delete"
        summary="desc"
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Confirm name' }), { target: { value: 'LOINC' } });
    const action = screen.getByRole('button', { name: /^Delete$/ });
    fireEvent.click(action);

    // onConfirm fired; the dialog goes busy — action shows "Delete…" + disabled, Cancel disabled.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(action).toBeDisabled());
    expect(action).toHaveTextContent('Delete…');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    // a second click while busy must not re-invoke onConfirm.
    fireEvent.click(action);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // once it settles, the busy state clears.
    resolveConfirm();
    await waitFor(() => expect(action).not.toBeDisabled());
    expect(action).toHaveTextContent('Delete');
  });
});
