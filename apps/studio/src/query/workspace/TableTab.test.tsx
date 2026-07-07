// apps/studio/src/query/workspace/TableTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { TableTab } from './TableTab';
import { queryApi } from '../api';
import type { TableTab as TableTabModel } from '../store';

vi.mock('../api', () => ({ queryApi: {
  run: vi.fn(),
  datasetRows: vi.fn(),
  connectors: vi.fn(async () => [{ id: 'c1', name: 'PG', type: 'postgres' }]),
} }));

const tab: TableTabModel = { id: 't1', kind: 'table', connectorId: 'c1', schema: 'public', table: 'products', title: 'products', sql: 'select * from "public"."products"', showSql: false };

describe('TableTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reflects a failed browse in the run-status icon', async () => {
    vi.mocked(queryApi.run).mockRejectedValue(new Error('connector not found or disabled'));
    render(<TableTab tab={tab} />);
    // Errors surface via the run-status icon (a red AlertCircle), not inline text — the message
    // itself lives in its tooltip.
    await waitFor(() => {
      const svg = document.querySelector('[role="status"] svg');
      expect(svg?.getAttribute('class') ?? '').toContain('text-destructive');
    });
  });
});
