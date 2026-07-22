import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ReportDesignerPage } from './ReportDesignerPage';
import { createReportDesign, updateReportDesign, deleteReportDesign, listReportDesigns } from '../api';

// Mock the API layer: the list + single-design loads resolve from the mock seed data (which the
// existing editor tests depend on), and the mutating calls resolve so we can assert they fire.
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  const { MOCK_TEMPLATES } = await import('./mockTemplates');
  return {
    ...actual,
    listReportDesigns: vi.fn(async () => MOCK_TEMPLATES),
    getReportDesign: vi.fn(async (id: string) => {
      const d = MOCK_TEMPLATES.find((t) => t.id === id);
      if (!d) throw new Error(`not found: ${id}`);
      return d;
    }),
    createReportDesign: vi.fn(async (d: unknown) => d),
    updateReportDesign: vi.fn(async (_id: string, d: unknown) => d),
    deleteReportDesign: vi.fn(async () => {}),
  };
});

// The Preview dialog pulls in PdfCanvasViewer → pdfjs, which needs DOM APIs jsdom lacks
// (DOMMatrix). Stub it — this suite exercises the page/editor, not PDF rendering.
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div data-testid="pdf-viewer" /> }));

// Render at the AMR design route so a design is loaded into the editor, mirroring the live
// `/report-designer/:id` entry point. Awaits the async load before returning.
async function renderPage(id = 'rt-amr-summary') {
  const utils = render(
    <MemoryRouter initialEntries={[`/report-designer/${id}`]}>
      <Routes>
        <Route path="/report-designer" element={<ReportDesignerPage />} />
        <Route path="/report-designer/:id" element={<ReportDesignerPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByLabelText('Report name');
  return utils;
}

// Open the canvas "More actions" kebab menu (mirrors the pointer/keyboard dance the insert tests use).
async function openKebab(): Promise<void> {
  const kebab = screen.getByRole('button', { name: /more actions/i });
  fireEvent.pointerDown(kebab, { button: 0, pointerType: 'mouse' });
  if (!screen.queryByRole('menuitem', { name: /new template/i })) fireEvent.keyDown(kebab, { key: 'Enter' });
  await screen.findByRole('menuitem', { name: /new template/i });
}

describe('ReportDesignerPage', () => {
  // Call history accumulates across tests otherwise (no clearMocks in config); the autosave tests
  // assert *absence* of calls, so start each test with a clean slate. clearAllMocks keeps the
  // vi.mock implementations, only wiping recorded calls.
  beforeEach(() => vi.clearAllMocks());

  it('shows a New template action in the empty (no-template) state', async () => {
    vi.mocked(listReportDesigns).mockResolvedValueOnce([]);
    render(
      <MemoryRouter initialEntries={['/report-designer']}>
        <Routes>
          <Route path="/report-designer" element={<ReportDesignerPage />} />
          <Route path="/report-designer/:id" element={<ReportDesignerPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Select or create a template')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New template/i })).toBeInTheDocument();
  });

  it('loads the design list into the explorer', async () => {
    await renderPage();
    const explorer = screen.getByTestId('templates-explorer');
    expect(within(explorer).getByText('AMR summary')).toBeInTheDocument();
    expect(within(explorer).getByText('Monthly caseload')).toBeInTheDocument();
    expect(within(explorer).getByText('Lab TAT')).toBeInTheDocument();
  });

  it('renders explorer, canvas header for the first template, and inspector', async () => {
    await renderPage();
    expect(screen.getByTestId('templates-explorer')).toBeInTheDocument();
    expect(screen.getByLabelText('Report name')).toHaveValue('AMR summary');
    expect(screen.getByTestId('inspector')).toBeInTheDocument();
  });

  it('collapses the explorer to a rail', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /collapse explorer/i }));
    expect(screen.queryByTestId('templates-explorer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expand explorer/i })).toBeInTheDocument();
  });

  it('switches the open template when another card is selected', async () => {
    await renderPage();
    fireEvent.click(await screen.findByText('Lab TAT'));
    expect(await screen.findByDisplayValue('Lab TAT')).toBeInTheDocument();
  });

  it('inserts a Text element which then appears in the Layers list', async () => {
    await renderPage();
    // Insert now lives inside the kebab (More actions) as a submenu.
    const kebab = screen.getByRole('button', { name: /more actions/i });
    fireEvent.pointerDown(kebab, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'Insert' })) fireEvent.keyDown(kebab, { key: 'Enter' });
    const insertSub = await screen.findByRole('menuitem', { name: 'Insert' });
    insertSub.focus();
    fireEvent.keyDown(insertSub, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text' }));
    fireEvent.click(within(screen.getByTestId('inspector')).getByRole('button', { name: 'Layers' }));
    // mock AMR page 1 already has a "Title" text element; inserting adds another "Text" layer
    expect(within(screen.getByTestId('inspector')).getByRole('button', { name: /^Text$/ })).toBeInTheDocument();
  });

  it('undoes an inserted element', async () => {
    await renderPage();
    const kebab = screen.getByRole('button', { name: /more actions/i });
    fireEvent.pointerDown(kebab, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'Insert' })) fireEvent.keyDown(kebab, { key: 'Enter' });
    const insertSub = await screen.findByRole('menuitem', { name: 'Insert' });
    insertSub.focus();
    fireEvent.keyDown(insertSub, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text' }));
    // the inserted generic "Text" layer exists...
    fireEvent.click(within(screen.getByTestId('inspector')).getByRole('button', { name: 'Layers' }));
    expect(within(screen.getByTestId('inspector')).getByRole('button', { name: /^Text$/ })).toBeInTheDocument();
    // ...and undo removes it (the seeded Title/Subtitle/Notes text layers remain, none named exactly "Text")
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(within(screen.getByTestId('inspector')).queryByRole('button', { name: /^Text$/ })).not.toBeInTheDocument();
  });

  it('deletes the selected element with the Delete key', async () => {
    await renderPage();
    // insert a Text element (kebab → Insert → Text), which becomes selected
    const kebab = screen.getByRole('button', { name: /more actions/i });
    fireEvent.pointerDown(kebab, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'Insert' })) fireEvent.keyDown(kebab, { key: 'Enter' });
    const insertSub = await screen.findByRole('menuitem', { name: 'Insert' });
    insertSub.focus();
    fireEvent.keyDown(insertSub, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text' }));
    fireEvent.click(within(screen.getByTestId('inspector')).getByRole('button', { name: 'Layers' }));
    expect(within(screen.getByTestId('inspector')).getByRole('button', { name: /^Text$/ })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(within(screen.getByTestId('inspector')).queryByRole('button', { name: /^Text$/ })).not.toBeInTheDocument();
  });

  it('reconciles the selection after undo removes a selected element', async () => {
    await renderPage();
    const inspector = () => screen.getByTestId('inspector');
    // insert a Text element (auto-selected)
    const kebab = screen.getByRole('button', { name: /more actions/i });
    fireEvent.pointerDown(kebab, { button: 0, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'Insert' })) fireEvent.keyDown(kebab, { key: 'Enter' });
    const insertSub = await screen.findByRole('menuitem', { name: 'Insert' });
    insertSub.focus();
    fireEvent.keyDown(insertSub, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text' }));
    // extend the selection to also include the seeded 'Title' element (now 2 selected)
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Layers' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' }), { shiftKey: true });
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Properties' }));
    expect(within(inspector()).getByText('2 elements selected')).toBeInTheDocument();
    // undo the insert → the Text element is gone; reconcile must drop its stale id (→ 1 left)
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(within(inspector()).queryByText('2 elements selected')).not.toBeInTheDocument();
  });

  it('undo reverses a committed drag', async () => {
    await renderPage();
    const inspector = () => screen.getByTestId('inspector');
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Layers' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Properties' }));
    expect(within(inspector()).getByLabelText('X')).toHaveValue(48);
    // drag Title to the right on the canvas → x changes
    fireEvent.pointerDown(screen.getByTestId('el-amr-title'), { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 190, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 190, clientY: 100 });
    expect(within(inspector()).getByLabelText('X')).not.toHaveValue(48);
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(within(inspector()).getByLabelText('X')).toHaveValue(48);
  });

  it('arrow keys nudge the selection and coalesce into one undo step', async () => {
    await renderPage();
    const inspector = () => screen.getByTestId('inspector');
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Layers' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Properties' }));
    expect(within(inspector()).getByLabelText('X')).toHaveValue(48);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(within(inspector()).getByLabelText('X')).toHaveValue(50); // 48 → 50
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(within(inspector()).getByLabelText('X')).toHaveValue(48); // single undo restores both nudges
  });

  it('edits a selected element geometry and undo restores it', async () => {
    await renderPage();
    const inspector = () => screen.getByTestId('inspector');
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Layers' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Properties' }));
    fireEvent.change(within(inspector()).getByLabelText('X'), { target: { value: '200' } });
    expect(within(inspector()).getByLabelText('X')).toHaveValue(200);
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(within(inspector()).getByLabelText('X')).toHaveValue(48);
  });

  it('edits text content and undo restores it', async () => {
    await renderPage();
    const inspector = () => screen.getByTestId('inspector');
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Layers' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Properties' }));
    const content = () => within(inspector()).getByLabelText('Content');
    fireEvent.change(content(), { target: { value: 'Changed' } });
    expect(content()).toHaveValue('Changed');
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(content()).toHaveValue('Antimicrobial resistance summary');
  });

  it('bulk-bolds a multi-text selection as one undo step', async () => {
    await renderPage();
    const inspector = () => screen.getByTestId('inspector');
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Layers' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Subtitle' }), { shiftKey: true });
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Properties' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Bold' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Layers' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' })); // single-select Title
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Properties' }));
    // its per-element Bold now reflects active (both were bolded)
    expect(within(inspector()).getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(within(inspector()).getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('double-click a text element on the canvas edits it inline and syncs the model', async () => {
    await renderPage();
    fireEvent.doubleClick(screen.getByTestId('el-amr-title'));
    const ta = screen.getByTestId('edit-amr-title');
    fireEvent.change(ta, { target: { value: 'Inline edit' } });
    fireEvent.keyDown(ta, { key: 'Escape' });
    // Properties Content field reflects the inline edit (element stays selected)
    fireEvent.click(within(screen.getByTestId('inspector')).getByRole('button', { name: 'Properties' }));
    expect(within(screen.getByTestId('inspector')).getByLabelText('Content')).toHaveValue('Inline edit');
  });

  it('double-clicking a text element in a multi-selection collapses to editing just it', async () => {
    await renderPage();
    const inspector = () => screen.getByTestId('inspector');
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Layers' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Subtitle' }), { shiftKey: true });
    fireEvent.doubleClick(screen.getByTestId('el-amr-title'));
    expect(screen.getByTestId('edit-amr-title')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-amr-subtitle')).toBeNull();
  });

  it('saves an existing design via updateReportDesign', async () => {
    await renderPage();
    await openKebab();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save' }));
    await waitFor(() => expect(updateReportDesign).toHaveBeenCalledWith('rt-amr-summary', expect.objectContaining({ id: 'rt-amr-summary' })));
  });

  it('creates a new (transient) design via createReportDesign on Save', async () => {
    await renderPage();
    await openKebab();
    fireEvent.click(await screen.findByRole('menuitem', { name: /new template/i }));
    expect(screen.getByLabelText('Report name')).toHaveValue('Untitled template');
    await openKebab();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save' }));
    await waitFor(() => expect(createReportDesign).toHaveBeenCalled());
  });

  it('reopens the original design after a transient is created and its card is clicked (URL unchanged)', async () => {
    await renderPage(); // opens AMR summary at /report-designer/rt-amr-summary
    // Create a transient design — this does NOT navigate, so the URL still points at rt-amr-summary.
    await openKebab();
    fireEvent.click(await screen.findByRole('menuitem', { name: /new template/i }));
    expect(screen.getByLabelText('Report name')).toHaveValue('Untitled template');
    // Click the AMR summary card. navigate('/report-designer/rt-amr-summary') would be a no-op
    // (URL already there), so the :id effect never re-runs — selection must fall back to local state.
    fireEvent.click(within(screen.getByTestId('templates-explorer')).getByText('AMR summary'));
    expect(await screen.findByDisplayValue('AMR summary')).toBeInTheDocument();
  });

  it('deletes the open design after confirmation via deleteReportDesign', async () => {
    await renderPage();
    await openKebab();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete design' }));
    await waitFor(() => expect(deleteReportDesign).toHaveBeenCalledWith('rt-amr-summary'));
  });

  it('autosaves a persisted design after the debounce and reflects Saving/Saved in the header', async () => {
    await renderPage(); // opens the persisted rt-amr-summary
    expect(screen.getByTestId('save-status')).toHaveTextContent('Saved');
    // Edit the name → immediately dirty, then autosaved after the ~1200ms debounce.
    fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'AMR summary edited' } });
    expect(screen.getByTestId('save-status')).toHaveTextContent('Unsaved changes');
    await waitFor(
      () => expect(updateReportDesign).toHaveBeenCalledWith('rt-amr-summary', expect.objectContaining({ id: 'rt-amr-summary', name: 'AMR summary edited' })),
      { timeout: 2500 },
    );
    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveTextContent('Saved'));
  });

  it('does NOT autosave a transient (unsaved) design — it stays "Unsaved" until explicit Save', async () => {
    await renderPage();
    await openKebab();
    fireEvent.click(await screen.findByRole('menuitem', { name: /new template/i }));
    expect(screen.getByLabelText('Report name')).toHaveValue('Untitled template');
    expect(screen.getByTestId('save-status')).toHaveTextContent('Unsaved changes');
    // Edit the transient design, then wait past the debounce window.
    fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'My draft' } });
    await new Promise((r) => setTimeout(r, 1400));
    expect(createReportDesign).not.toHaveBeenCalled(); // never auto-created
    expect(updateReportDesign).not.toHaveBeenCalled();
    expect(screen.getByTestId('save-status')).toHaveTextContent('Unsaved changes');
  });

  it('does not autosave a freshly loaded design when nothing is edited', async () => {
    await renderPage();
    expect(screen.getByTestId('save-status')).toHaveTextContent('Saved');
    await new Promise((r) => setTimeout(r, 1400));
    expect(updateReportDesign).not.toHaveBeenCalled();
  });

  it('a late-resolving autosave for design A does not force the now-open design B to "Saved"', async () => {
    await renderPage(); // opens A = rt-amr-summary (persisted)
    // Make A's autosave PUT hang until we resolve it manually.
    let resolveA: (v: unknown) => void = () => {};
    const deferred = new Promise((res) => { resolveA = res; });
    vi.mocked(updateReportDesign).mockImplementationOnce(() => deferred as never);
    // Edit A → schedules the autosave debounce.
    fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'A edited' } });
    // Debounce fires the PUT, which now hangs on our deferred → status is "Saving…".
    await waitFor(
      () => expect(updateReportDesign).toHaveBeenCalledWith('rt-amr-summary', expect.objectContaining({ name: 'A edited' })),
      { timeout: 2500 },
    );
    expect(screen.getByTestId('save-status')).toHaveTextContent('Saving');
    // Switch to a fresh transient design B BEFORE A resolves. B is unsaved and never autosaves.
    await openKebab();
    fireEvent.click(await screen.findByRole('menuitem', { name: /new template/i }));
    expect(screen.getByLabelText('Report name')).toHaveValue('Untitled template');
    expect(screen.getByTestId('save-status')).toHaveTextContent('Unsaved changes');
    // Now let A's PUT resolve LATE. Without the open-id guard, A's .then would force status → "Saved".
    resolveA({ id: 'rt-amr-summary', name: 'A edited', paper: 'A4', orientation: 'portrait', pages: [], parameters: [] });
    await new Promise((r) => setTimeout(r, 0)); // flush the resolution microtasks
    // B's status must still reflect B (unsaved), not be clobbered by A's late save.
    expect(screen.getByTestId('save-status')).toHaveTextContent('Unsaved changes');
  });
});
