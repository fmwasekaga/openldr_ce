import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from './Dashboard';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 300 });
  // Recharts ResponsiveContainer uses ResizeObserver, absent in jsdom.
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/reports') {
      return new Response(JSON.stringify([{ id: 'amr-resistance', name: 'AMR Resistance Rate', description: 'd' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      columns: [{ key: 'antibiotic', label: 'Antibiotic', kind: 'string' }], rows: [{ antibiotic: 'AMP' }],
      chart: { type: 'bar', x: 'antibiotic', y: 'antibiotic' }, meta: { generatedAt: 'x', rowCount: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

describe('Dashboard', () => {
  it('lists report cards from the API', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('AMR Resistance Rate')).toBeInTheDocument());
  });
});
