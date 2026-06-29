import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Sidebar } from './sidebar';
import * as api from '@/api';

vi.mock('@/api', async (orig) => ({
  ...(await orig<typeof api>()),
  fetchWorkflowNodes: vi.fn(),
}));

beforeEach(() => {
  (api.fetchWorkflowNodes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe('Sidebar palette categories', () => {
  it('renders categories collapsed by default and expands on header click', async () => {
    render(<Sidebar />);
    // The "Core" category header is always shown, but its items are hidden initially.
    const coreHeader = await screen.findByText('Core');
    expect(screen.queryByText('Manual Trigger')).not.toBeInTheDocument();

    // Click the category header button to expand it.
    const headerButton = coreHeader.closest('button');
    expect(headerButton).toBeTruthy();
    fireEvent.click(headerButton!);

    await waitFor(() => expect(screen.getByText('Manual Trigger')).toBeInTheDocument());
  });
});
