import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TermPicker } from './TermPicker';
import * as api from '../api';

describe('TermPicker', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('searches and selects a term', async () => {
    vi.spyOn(api, 'searchTerms').mockResolvedValue({ rows: [{ system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', shortName: null, class: null, unit: null, replacedBy: null, metadata: null, mappingCount: 0 }], total: 1 } as never);
    const onChange = vi.fn();
    render(<TermPicker value={null} onChange={onChange} systemId="sys1" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'amp' } });
    const opt = await screen.findByText(/Ampicillin/);
    fireEvent.click(opt);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ code: 'AMP', system: 'http://x' }));
  });

  it('shows the selected value as a chip with a clear button', () => {
    const onChange = vi.fn();
    render(<TermPicker value={{ system: 'http://x', code: 'AMP', display: 'Ampicillin' }} onChange={onChange} systemId="sys1" />);
    expect(screen.getByText(/AMP/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
