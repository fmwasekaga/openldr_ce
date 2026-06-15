import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CodingSystemDialog } from './CodingSystemDialog';
import * as api from '../api';

describe('CodingSystemDialog', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('creates a code system (upper-cases the code)', async () => {
    vi.spyOn(api, 'listPublishers').mockResolvedValue([]);
    const created = {
      id: 'c9',
      systemCode: 'X',
      systemName: 'X sys',
      url: null,
      systemVersion: null,
      description: null,
      active: true,
      publisherId: null,
      seeded: false,
    };
    vi.spyOn(api, 'createCodingSystem').mockResolvedValue(created as never);
    const onSaved = vi.fn();
    render(
      <CodingSystemDialog
        open
        system={null}
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByLabelText('System code'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('System name'), { target: { value: 'X sys' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() =>
      expect(api.createCodingSystem).toHaveBeenCalledWith(
        expect.objectContaining({ systemCode: 'X', systemName: 'X sys' }),
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
  });

  it('disables the System code field when editing', () => {
    vi.spyOn(api, 'listPublishers').mockResolvedValue([]);
    const sys = {
      id: 'c1',
      systemCode: 'LOINC',
      systemName: 'L',
      url: null,
      systemVersion: null,
      description: null,
      active: true,
      publisherId: null,
      seeded: true,
    };
    render(
      <CodingSystemDialog
        open
        system={sys as never}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByLabelText('System code')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
