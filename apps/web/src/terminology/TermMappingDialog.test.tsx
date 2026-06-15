import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TermMappingDialog } from './TermMappingDialog';
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

const fromTerm = {
  system: 'http://x',
  code: 'AMP',
  display: 'Ampicillin',
  systemCode: 'WHONET',
};

const stubMapping: api.TermMapping = {
  id: 'm1',
  fromSystem: 'http://x',
  fromCode: 'AMP',
  toSystem: 'http://loinc.org',
  toCode: '1',
  toDisplay: 'L',
  mapType: 'SAME-AS',
  relationship: null,
  owner: null,
  isActive: true,
};

describe('TermMappingDialog', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders the sheet header in create mode', () => {
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByText('New mapping')).toBeTruthy();
    // from-term shown in description
    expect(screen.getByText(/WHONET.*AMP/)).toBeTruthy();
  });

  it('renders the sheet header in edit mode', () => {
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        mapping={stubMapping}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByText('Edit mapping')).toBeTruthy();
  });

  it('creates a manual mapping and reports draftCreated=true', async () => {
    vi.spyOn(api, 'createTermMapping').mockResolvedValue({
      mapping: stubMapping,
      draftCreated: true,
    });
    const onSaved = vi.fn();
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );

    // Switch to manual mode
    fireEvent.click(screen.getByRole('button', { name: /manual/i }));

    // Fill manual code (the system Select is pre-seeded to the first active system)
    const codeInput = screen.getByPlaceholderText('441407007');
    fireEvent.change(codeInput, { target: { value: '1' } });

    // Open the ⋯ dropdown (Radix opens on pointerDown in jsdom)
    const actionsBtn = screen.getByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actionsBtn, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Create')) {
      fireEvent.keyDown(actionsBtn, { key: 'Enter' });
    }
    const createItem = await screen.findByText('Create');
    fireEvent.pointerMove(createItem);
    fireEvent.click(createItem);

    await waitFor(() => {
      expect(api.createTermMapping).toHaveBeenCalledWith(
        'http://x',
        'AMP',
        expect.objectContaining({ toCode: '1', mapType: 'SAME-AS', isActive: true }),
      );
      expect(onSaved).toHaveBeenCalledWith(stubMapping, true);
    });
  });

  it('updates an existing mapping and reports draftCreated=false', async () => {
    const updated = { ...stubMapping, toCode: '2' };
    vi.spyOn(api, 'updateTermMapping').mockResolvedValue(updated);
    const onSaved = vi.fn();
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        mapping={stubMapping}
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );

    // In edit mode the dialog opens in manual mode, code field pre-filled
    const codeInput = screen.getByPlaceholderText('441407007');
    expect((codeInput as HTMLInputElement).value).toBe('1');

    // Change the code
    fireEvent.change(codeInput, { target: { value: '2' } });

    // Open the ⋯ dropdown (Radix opens on pointerDown in jsdom)
    const actionsBtn = screen.getByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actionsBtn, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Save')) {
      fireEvent.keyDown(actionsBtn, { key: 'Enter' });
    }
    const saveItem = await screen.findByText('Save');
    fireEvent.pointerMove(saveItem);
    fireEvent.click(saveItem);

    await waitFor(() => {
      expect(api.updateTermMapping).toHaveBeenCalledWith(
        'm1',
        expect.objectContaining({ fromSystem: 'http://x', fromCode: 'AMP', toCode: '2' }),
      );
      expect(onSaved).toHaveBeenCalledWith(updated, false);
    });
  });

  it('shows the "Browse LOINC" button disabled in manual mode with a tooltip', () => {
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );

    // Switch to manual mode
    fireEvent.click(screen.getByRole('button', { name: /manual/i }));

    // Browse button must be present and disabled (system pre-seeded to sys1=LOINC)
    const browseBtn = screen.getByRole('button', { name: /browse loinc/i });
    expect(browseBtn).toBeTruthy();
    expect(browseBtn).toBeDisabled();
  });

  it('shows general section fields: map-type select, relationship, owner', () => {
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.getByText('Map type')).toBeTruthy();
    expect(screen.getByText('Relationship')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
  });

  it('disables Create until a manual target code is entered', async () => {
    vi.spyOn(api, 'createTermMapping').mockResolvedValue({
      mapping: stubMapping,
      draftCreated: false,
    });
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system as never]}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    // Switch to manual mode (code field is empty → canSave=false)
    fireEvent.click(screen.getByRole('button', { name: /manual/i }));

    // Open the Actions dropdown (same technique as the create/update tests above)
    const actionsBtn = screen.getByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actionsBtn, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Create')) {
      fireEvent.keyDown(actionsBtn, { key: 'Enter' });
    }

    // Find the Create menu item — Radix sets data-disabled on a disabled DropdownMenuItem
    const createItem = await screen.findByText('Create');
    const menuItem = createItem.closest('[role="menuitem"]') ?? createItem;
    expect(menuItem).toHaveAttribute('data-disabled');

    // Clicking it must NOT invoke the API
    fireEvent.click(createItem);
    expect(api.createTermMapping).not.toHaveBeenCalled();
  });

  it('shows the status section with is-active checkbox checked by default', () => {
    render(
      <TermMappingDialog
        open
        fromTerm={fromTerm}
        systems={[system]}
        mapping={null}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByText('Status')).toBeTruthy();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeTruthy();
    // Default isActive=true
    expect((checkbox as HTMLInputElement).getAttribute('data-state')).toBe('checked');
  });
});
