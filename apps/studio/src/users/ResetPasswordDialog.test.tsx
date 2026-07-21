import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, resetUserPassword: vi.fn() };
});
import { resetUserPassword } from '@/api';
import { ResetPasswordDialog } from './ResetPasswordDialog';

const user = { id: 'u1', subject: 's1', username: 'ada', displayName: 'Ada', email: null, roles: [], status: 'active' as const, lastLoginAt: null, createdAt: null };

beforeEach(() => vi.clearAllMocks());

describe('ResetPasswordDialog', () => {
  it('rejects mismatched passwords without calling the api', async () => {
    render(<ResetPasswordDialog open user={user} onOpenChange={() => {}} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'xyz' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    await waitFor(() => expect(screen.getByText('Passwords do not match.')).toBeTruthy());
    expect(resetUserPassword).not.toHaveBeenCalled();
  });

  it('submits a matching password requiring change by default (temporary=true) and signals done', async () => {
    (resetUserPassword as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const onDone = vi.fn();
    render(<ResetPasswordDialog open user={user} onOpenChange={() => {}} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    await waitFor(() => expect(resetUserPassword).toHaveBeenCalledWith('u1', 'abc', true));
    expect(onDone).toHaveBeenCalled();
  });

  it('rejects an empty password without calling the api', async () => {
    render(<ResetPasswordDialog open user={user} onOpenChange={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    await waitFor(() => expect(screen.getByText('Password is required.')).toBeTruthy());
    expect(resetUserPassword).not.toHaveBeenCalled();
  });

  it('masks both fields by default and reveals them via the eye toggle', () => {
    render(<ResetPasswordDialog open user={user} onOpenChange={() => {}} onDone={() => {}} />);
    const newPw = screen.getByLabelText('New password') as HTMLInputElement;
    const confirm = screen.getByLabelText('Confirm password') as HTMLInputElement;
    expect(newPw.type).toBe('password');
    expect(confirm.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(newPw.type).toBe('text');
    expect(confirm.type).toBe('text');
    // now a hide control is offered
    expect(screen.getByRole('button', { name: /hide password/i })).toBeTruthy();
  });

  it('fills both fields with a matching generated password', () => {
    render(<ResetPasswordDialog open user={user} onOpenChange={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    const newPw = screen.getByLabelText('New password') as HTMLInputElement;
    const confirm = screen.getByLabelText('Confirm password') as HTMLInputElement;
    expect(newPw.value.length).toBeGreaterThanOrEqual(12);
    expect(confirm.value).toBe(newPw.value);
  });

  it('sets a permanent password (temporary=false) when require-change is unchecked', async () => {
    (resetUserPassword as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<ResetPasswordDialog open user={user} onOpenChange={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox')); // uncheck the default-on "require change"
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    await waitFor(() => expect(resetUserPassword).toHaveBeenCalledWith('u1', 'abc', false));
  });
});
