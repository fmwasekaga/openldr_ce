// apps/studio/src/query/tree/ExplorerTree.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { ExplorerTree } from './ExplorerTree';
import { queryApi } from '../api';

vi.mock('../api', () => ({ queryApi: {
  connectors: vi.fn(async () => [{ id: 'c1', name: 'PG', type: 'postgres' }]),
  schemas: vi.fn(async () => ['public']),
  tables: vi.fn(async () => ['products']),
  datasets: vi.fn(async () => [{ id: 'd1', name: 'AMR', rowCount: 2 }]),
  list: vi.fn(async () => [{ id: 'cq1', name: 'Q1', connectorId: 'c1', sql: '', params: [] }]),
  remove: vi.fn(async () => ({ ok: true })),
} }));

describe('ExplorerTree', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the three system branches and lazy-loads a connector', async () => {
    render(<ExplorerTree />);
    await screen.findByText('Connectors');
    expect(screen.getByText('Datasets')).toBeInTheDocument();
    expect(screen.getByText('Custom Queries')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Connectors'));
    await screen.findByText('PG');
    fireEvent.click(screen.getByText('PG'));
    await waitFor(() => expect(queryApi.schemas).toHaveBeenCalledWith('c1'));
  });

  it('deletes a custom query after confirming in the dialog', async () => {
    render(<ExplorerTree />);
    fireEvent.click(await screen.findByText('Custom Queries'));
    await screen.findByText('Q1');
    fireEvent.click(screen.getByLabelText('Delete query'));
    // A confirm dialog opens; the query is only removed once confirmed.
    const dialog = await screen.findByRole('alertdialog');
    expect(queryApi.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete query' }));
    await waitFor(() => expect(queryApi.remove).toHaveBeenCalledWith('cq1'));
  });
});
