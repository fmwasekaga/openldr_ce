import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportSettings } from './ReportSettings';

const page = { size: 'A4' as const, orientation: 'portrait' as const, margins: { top: 40, right: 40, bottom: 40, left: 40 } };

describe('ReportSettings', () => {
  it('changes page size', () => {
    const onPatch = vi.fn();
    render(<ReportSettings page={page} onPatch={onPatch} onOpenParams={() => {}} />);
    fireEvent.change(screen.getByLabelText(/page size/i), { target: { value: 'Letter' } });
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ size: 'Letter' }));
  });
  it('toggles orientation to landscape', () => {
    const onPatch = vi.fn();
    render(<ReportSettings page={page} onPatch={onPatch} onOpenParams={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /landscape/i }));
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ orientation: 'landscape' }));
  });
  it('edits the top margin', () => {
    const onPatch = vi.fn();
    render(<ReportSettings page={page} onPatch={onPatch} onOpenParams={() => {}} />);
    fireEvent.change(screen.getByLabelText(/top/i), { target: { value: '20' } });
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ margins: expect.objectContaining({ top: 20 }) }));
  });
  it('opens parameters', () => {
    const onOpenParams = vi.fn();
    render(<ReportSettings page={page} onPatch={() => {}} onOpenParams={onOpenParams} />);
    fireEvent.click(screen.getByRole('button', { name: /parameters/i }));
    expect(onOpenParams).toHaveBeenCalled();
  });
});
