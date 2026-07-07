// apps/studio/src/query/workspace/QueryTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryTab } from './QueryTab';
import { queryApi } from '../api';
import type { QueryTab as QueryTabModel } from '../store';

vi.mock('../api', () => ({ queryApi: {
  connectors: vi.fn(async () => [{ id: 'c1', name: 'PG', type: 'postgres' }]),
  run: vi.fn(async () => ({ columns: [{ key: 'n', label: 'n' }], rows: [{ n: 1 }], rowCount: 1, ms: 3 })),
  paramOptions: vi.fn(async () => []),
} }));

const tab: QueryTabModel = { id: 't1', kind: 'query', title: 'Query #1', connectorId: 'c1', sql: 'select 1 as n', params: [], dirty: false };

describe('QueryTab', () => {
  beforeEach(() => vi.clearAllMocks());
  it('runs a query with no params and shows results', async () => {
    render(<QueryTab tab={tab} />);
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    await waitFor(() => expect(queryApi.run).toHaveBeenCalled());
    // The results grid is a canvas (glide-data-grid) that no-ops under jsdom, so assert on the
    // pagination summary the run produced (rowCount/ms) rather than a DOM cell.
    expect(await screen.findByText('1 rows · 3ms')).toBeInTheDocument();
  });
});
