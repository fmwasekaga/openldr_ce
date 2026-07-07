// apps/studio/src/query/workspace/TableTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TableTab } from './TableTab';
import { queryApi } from '../api';
import type { TableTab as TableTabModel } from '../store';

vi.mock('../api', () => ({ queryApi: {
  run: vi.fn(),
  datasetRows: vi.fn(),
} }));

const tab: TableTabModel = { id: 't1', kind: 'table', connectorId: 'c1', schema: 'public', table: 'products', title: 'products', sql: 'select * from "public"."products"', showSql: false };

describe('TableTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders an error message when the browse query fails', async () => {
    vi.mocked(queryApi.run).mockRejectedValue(new Error('connector not found or disabled'));
    render(<TableTab tab={tab} />);
    expect(await screen.findByText('connector not found or disabled')).toBeInTheDocument();
  });
});
