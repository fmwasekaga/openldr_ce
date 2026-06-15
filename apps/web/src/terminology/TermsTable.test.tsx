import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TermsTable } from './TermsTable';
import * as api from '../api';

const term = (code: string, display: string, status = 'ACTIVE') => ({
  system: 'http://x',
  code,
  display,
  status,
  shortName: null,
  class: null,
  unit: null,
  replacedBy: null,
  metadata: null,
  mappingCount: 0,
});

describe('TermsTable', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders terms from searchTerms', async () => {
    vi.spyOn(api, 'searchTerms').mockResolvedValue({
      rows: [term('AMP', 'Ampicillin')],
      total: 1,
    } as never);
    render(<TermsTable systemId="sys1" onOpenTerm={() => {}} />);
    await waitFor(() => expect(screen.getByText('Ampicillin')).toBeInTheDocument());
    expect(screen.getByText('AMP')).toBeInTheDocument();
  });

  it('typing in search refetches with q', async () => {
    const spy = vi
      .spyOn(api, 'searchTerms')
      .mockResolvedValue({ rows: [], total: 0 } as never);
    render(<TermsTable systemId="sys1" onOpenTerm={() => {}} />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText(/search terms/i), {
      target: { value: 'cip' },
    });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        'sys1',
        expect.objectContaining({ q: 'cip' }),
      ),
    );
  });
});
