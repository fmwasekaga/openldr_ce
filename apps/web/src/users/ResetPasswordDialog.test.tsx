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

  it('submits a matching password (temporary) and signals done', async () => {
    (resetUserPassword as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const onDone = vi.fn();
    render(<ResetPasswordDialog open user={user} onOpenChange={() => {}} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    await waitFor(() => expect(resetUserPassword).toHaveBeenCalledWith('u1', 'abc', true));
    expect(onDone).toHaveBeenCalled();
  });
});
