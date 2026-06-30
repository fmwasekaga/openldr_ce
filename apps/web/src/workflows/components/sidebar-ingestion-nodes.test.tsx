import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Sidebar } from './sidebar';
import * as api from '@/api';

vi.mock('@/api', async (orig) => ({ ...(await orig<typeof api>()), fetchWorkflowNodes: vi.fn() }));

beforeEach(() => {
  (api.fetchWorkflowNodes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe('Sidebar — ingestion nodes', () => {
  it('shows Form Validate and Persist Store as draggable palette items', async () => {
    render(<Sidebar />);
    const coreHeader = await screen.findByText('Core');
    fireEvent.click(coreHeader.closest('button')!);

    const formValidate = await screen.findByText('Form Validate');
    const persistStore = await screen.findByText('Persist Store');

    expect(formValidate.closest('[draggable]')).toHaveAttribute('draggable', 'true');
    expect(persistStore.closest('[draggable]')).toHaveAttribute('draggable', 'true');
  });
});
