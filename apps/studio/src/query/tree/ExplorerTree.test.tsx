// apps/studio/src/query/tree/ExplorerTree.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ExplorerTree } from './ExplorerTree';
import { queryApi } from '../api';

vi.mock('../api', () => ({ queryApi: {
  connectors: vi.fn(async () => [{ id: 'c1', name: 'PG', type: 'postgres' }]),
  schemas: vi.fn(async () => ['public']),
  tables: vi.fn(async () => ['products']),
  datasets: vi.fn(async () => [{ id: 'd1', name: 'AMR', rowCount: 2 }]),
  list: vi.fn(async () => [{ id: 'cq1', name: 'Q1', connectorId: 'c1', sql: '', params: [] }]),
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
});
