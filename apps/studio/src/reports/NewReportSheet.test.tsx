import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

const { createReportDef } = vi.hoisted(() => ({ createReportDef: vi.fn(async (x: unknown) => x) }));
vi.mock('./reportDefsApi', () => ({ createReportDef }));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    listReportDesigns: vi.fn(async () => [
      {
        id: 'd1', name: 'AMR', paper: 'A4', orientation: 'portrait',
        parameters: [{ key: 'facility', label: 'Facility', type: 'select' }],
        pages: [{ id: 'p', elements: [{ id: 't', kind: 'table', name: 'T', rect: { x: 0, y: 0, w: 1, h: 1 }, dataSource: { kind: 'custom-query', queryId: 'q1' } }] }],
      },
    ]),
  };
});

vi.mock('../query/api', () => ({ queryApi: { list: vi.fn(async () => [{ id: 'q1', name: 'AMR query', connectorId: 'c1', sql: 'select 1', params: [] }]) } }));

import { NewReportSheet } from './NewReportSheet';

describe('NewReportSheet', () => {
  beforeEach(() => createReportDef.mockClear());

  it("previews the chosen template's filters", async () => {
    render(<NewReportSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await waitFor(() => expect(screen.getByText('Facility')).toBeInTheDocument());
  });

  it('creates a published report on submit', async () => {
    const onCreated = vi.fn();
    render(<NewReportSheet open onOpenChange={() => {}} onCreated={onCreated} />);
    await waitFor(() => screen.getByText('Facility'));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'AMR Resistance' } });
    fireEvent.click(screen.getByRole('button', { name: /create report/i }));
    await waitFor(() => expect(createReportDef).toHaveBeenCalledWith(expect.objectContaining({
      name: 'AMR Resistance', designId: 'd1', primaryQueryId: 'q1', status: 'published',
    })));
    expect(onCreated).toHaveBeenCalled();
  });

  it('disables Create while name is empty', async () => {
    render(<NewReportSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await waitFor(() => screen.getByText('Facility'));
    expect(screen.getByRole('button', { name: /create report/i })).toBeDisabled();
  });

  it('renders as a Sheet (dialog role) sliding from the right', async () => {
    render(<NewReportSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await waitFor(() => screen.getByText('Facility'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
