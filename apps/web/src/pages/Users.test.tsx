import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Users } from './Users';
import * as api from '../api';

const ada = {
  id: 'u1',
  subject: null,
  username: 'ada',
  displayName: 'Ada Lovelace',
  email: 'ada@test.local',
  roles: ['lab_admin'],
  status: 'active' as const,
  lastLoginAt: null,
};

describe('Users page', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listUsers').mockResolvedValue([ada]);
    vi.spyOn(api, 'createUser').mockResolvedValue({ ...ada, id: 'u2', username: 'grace', displayName: 'Grace Hopper', email: 'grace@test.local', roles: ['data_analyst'] });
    vi.spyOn(api, 'updateUser').mockImplementation(async (id, input) => ({ ...ada, id, ...input }));
    vi.spyOn(api, 'setUserStatus').mockResolvedValue({ ...ada, status: 'disabled' });
  });

  it('lists users, creates a user, and disables a user from row actions', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>);

    expect(await screen.findByText('ada')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /new user/i }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'grace' } });
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Grace Hopper' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'grace@test.local' } });
    fireEvent.change(screen.getByLabelText('Add role'), { target: { value: 'data_analyst' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith(expect.objectContaining({ username: 'grace', roles: ['data_analyst'] })));
    expect(await screen.findByText('grace')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: /actions for ada/i }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Disable')) fireEvent.keyDown(screen.getByRole('button', { name: /actions for ada/i }), { key: 'Enter' });
    fireEvent.click(await screen.findByText('Disable'));

    await waitFor(() => expect(api.setUserStatus).toHaveBeenCalledWith('u1', 'disabled'));
  });
});
