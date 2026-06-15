import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TermDialog } from './TermDialog';
import * as api from '../api';

const system: api.CodingSystem = {
  id: 'sys1',
  systemCode: 'LOINC',
  systemName: 'LOINC',
  url: 'http://loinc.org',
  systemVersion: null,
  description: null,
  active: true,
  publisherId: 'p',
  seeded: true,
};

describe('TermDialog', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('creates a term from the Details tab', async () => {
    const created: api.Term = {
      system: 'http://loinc.org',
      code: 'X',
      display: 'X term',
      status: 'ACTIVE',
      shortName: null,
      class: null,
      unit: null,
      replacedBy: null,
      metadata: null,
      mappingCount: 0,
    };
    vi.spyOn(api, 'createTerm').mockResolvedValue(created);
    const onSaved = vi.fn();

    render(
      <TermDialog
        open
        system={system}
        term={null}
        onOpenChange={() => {}}
        onSaved={onSaved}
        onDeleted={() => {}}
      />,
    );

    // Code input — label is "Code"
    fireEvent.change(screen.getByLabelText(/^code$/i), { target: { value: 'X' } });
    // Display name input — label is "Display name"
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'X term' } });

    // Open the ⋯ actions menu — Radix opens on pointerdown under jsdom
    const actionsBtn = screen.getByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actionsBtn, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /create/i })) {
      fireEvent.keyDown(actionsBtn, { key: 'Enter' });
    }

    // Click the Create menuitem
    const createItem = await screen.findByRole('menuitem', { name: /create/i });
    fireEvent.pointerMove(createItem);
    fireEvent.click(createItem);

    await waitFor(() =>
      expect(api.createTerm).toHaveBeenCalledWith(
        'sys1',
        expect.objectContaining({ code: 'X', display: 'X term' }),
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('disables the Mappings tab when creating (term=null)', () => {
    render(
      <TermDialog
        open
        system={system}
        term={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
        onDeleted={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /mappings/i })).toBeDisabled();
  });
});
