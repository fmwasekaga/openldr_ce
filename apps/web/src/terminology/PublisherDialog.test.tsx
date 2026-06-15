import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PublisherDialog } from './PublisherDialog';
import * as api from '../api';

describe('PublisherDialog', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('creates a publisher', async () => {
    const created = { id: 'p9', name: 'My Lab', role: 'local', icon: null, seeded: false, sortOrder: 100 };
    vi.spyOn(api, 'createPublisher').mockResolvedValue(created as never);
    const onSaved = vi.fn();
    render(<PublisherDialog open publisher={null} onOpenChange={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My Lab' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
  });

  it('edits an existing publisher (Save label, updatePublisher called)', async () => {
    const existing = { id: 'p1', name: 'Lab', role: 'local', icon: null, seeded: false, sortOrder: 5 };
    const updated = { ...existing, name: 'Lab 2' };
    vi.spyOn(api, 'updatePublisher').mockResolvedValue(updated as never);
    const onSaved = vi.fn();
    render(<PublisherDialog open publisher={existing as never} onOpenChange={() => {}} onSaved={onSaved} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Lab 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updatePublisher).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Lab 2' })));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
  });

  it('disables the Role control for a seeded publisher', () => {
    const seeded = { id: 'pub-loinc', name: 'LOINC', role: 'external', icon: null, seeded: true, sortOrder: 2 };
    render(<PublisherDialog open publisher={seeded as never} onOpenChange={() => {}} onSaved={() => {}} />);
    // The Role select trigger is a combobox; when disabled Radix sets data-disabled / disabled.
    const role = screen.getByLabelText('Role');
    expect(role).toBeDisabled();
  });
});
