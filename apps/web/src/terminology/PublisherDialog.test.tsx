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
});
