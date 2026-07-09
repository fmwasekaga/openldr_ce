import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

const { createReportDef } = vi.hoisted(() => ({ createReportDef: vi.fn(async (x: unknown) => x) }));
vi.mock('./reportDefsApi', () => ({ createReportDef }));

const { listReportCategories, saveReportCategories } = vi.hoisted(() => ({
  listReportCategories: vi.fn(async () => [
    { id: 'amr', label: 'AMR / Surveillance', order: 0 },
    { id: 'operational', label: 'Operational', order: 1 },
  ]),
  saveReportCategories: vi.fn(async (list: unknown) => list),
}));
vi.mock('./reportCategoriesApi', () => ({ listReportCategories, saveReportCategories }));

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

function openMenu() {
  const trigger = screen.getByRole('button', { name: /actions|more/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('NewReportSheet', () => {
  beforeEach(() => {
    createReportDef.mockClear();
    listReportCategories.mockClear();
    saveReportCategories.mockClear();
  });

  it("previews the chosen template's filters", async () => {
    render(<NewReportSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await waitFor(() => expect(screen.getByText('Facility')).toBeInTheDocument());
  });

  it('creates a published report via the ⋯ menu Create action', async () => {
    const onCreated = vi.fn();
    render(<NewReportSheet open onOpenChange={() => {}} onCreated={onCreated} />);
    await waitFor(() => screen.getByText('Facility'));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'AMR Resistance' } });
    openMenu();
    fireEvent.click(await screen.findByText(/create report/i));
    await waitFor(() => expect(createReportDef).toHaveBeenCalledWith(expect.objectContaining({
      name: 'AMR Resistance', designId: 'd1', primaryQueryId: 'q1', category: 'amr', status: 'published',
    })));
    expect(onCreated).toHaveBeenCalled();
  });

  it('disables the Create item in the ⋯ menu while name is empty', async () => {
    render(<NewReportSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await waitFor(() => screen.getByText('Facility'));
    openMenu();
    const item = (await screen.findByText(/create report/i)).closest('[role="menuitem"]');
    expect(item?.hasAttribute('data-disabled') || item?.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('does not fire Create when the menu item is disabled', async () => {
    render(<NewReportSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await waitFor(() => screen.getByText('Facility'));
    openMenu();
    fireEvent.click(await screen.findByText(/create report/i));
    expect(createReportDef).not.toHaveBeenCalled();
  });

  it('renders as a Sheet (dialog role) sliding from the right', async () => {
    render(<NewReportSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await waitFor(() => screen.getByText('Facility'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has no standalone Cancel/Create footer buttons — only the ✕ close and the ⋯ menu', async () => {
    render(<NewReportSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await waitFor(() => screen.getByText('Facility'));
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^create report$/i })).not.toBeInTheDocument();
  });

  it('loads categories and defaults the selection to the first one', async () => {
    render(<NewReportSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await waitFor(() => expect(listReportCategories).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /AMR \/ Surveillance/i })).toBeInTheDocument());
  });
});
