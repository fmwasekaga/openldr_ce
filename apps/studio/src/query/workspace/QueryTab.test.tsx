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
    // Assert the value shows in the results grid specifically (a <td> has role "cell");
    // scoping avoids matching the CodeMirror gutter/line-number "1" that jsdom also renders.
    expect(await screen.findByRole('cell', { name: '1' })).toBeInTheDocument();
  });
});
