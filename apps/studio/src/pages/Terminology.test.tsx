import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { Terminology } from './Terminology';
import * as api from '../api';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));

vi.mock('../terminology/ontology/OntologyPickerDialog', () => ({
  OntologyPickerDialog: ({ open, systemName }: { open: boolean; systemName: string }) =>
    open ? <div role="dialog">Browse mock {systemName}</div> : null,
}));

vi.mock('../terminology/ontology/OntologyDistributionDialog', () => ({
  OntologyDistributionDialog: ({ open, systemName }: { open: boolean; systemName: string }) =>
    open ? <div role="dialog">Distribution mock {systemName}</div> : null,
}));

const pub = (id: string, name: string, seeded = true) => ({
  id,
  name,
  role: 'external',
  icon: null,
  seeded,
  sortOrder: 1,
});

const sys = (id: string, code: string, pubId: string) => ({
  id,
  systemCode: code,
  systemName: code,
  url: `http://${code}.org`,
  systemVersion: null,
  description: null,
  active: true,
  publisherId: pubId,
  seeded: true,
});

describe('Terminology page', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.spyOn(api, 'listPublishers').mockResolvedValue([
      pub('pub-loinc', 'LOINC'),
      pub('pub-snomed-ct', 'SNOMED CT'),
    ] as never);
    vi.spyOn(api, 'listCodingSystems').mockResolvedValue([
      sys('cs1', 'LOINC', 'pub-loinc'),
    ] as never);
    vi.spyOn(api, 'listValueSets').mockResolvedValue([] as never);
    vi.spyOn(api, 'listOntologyDistributions').mockResolvedValue([] as never);
  });

  it('shows the empty prompt when there are no publishers', async () => {
    vi.spyOn(api, 'listPublishers').mockResolvedValue([] as never);
    vi.spyOn(api, 'listCodingSystems').mockResolvedValue([] as never);
    render(<MemoryRouter><Terminology /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Select a publisher to browse/i)).toBeInTheDocument());
  });

  it('renders the publisher rail and a code-system', async () => {
    render(
      <MemoryRouter>
        <Terminology />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByText('Publishers')).toBeInTheDocument(),
    );

    // "LOINC" appears both as a rail publisher and a system code, so tolerate multiple.
    expect(screen.getAllByText('LOINC').length).toBeGreaterThan(0);
  });

  it('toggles to value sets and opens one in the builder sheet', async () => {
    vi.spyOn(api, 'listValueSets').mockResolvedValue([
      {
        id: 'vs-yn',
        url: 'urn:openldr:vs:yes-no',
        name: 'YesNo',
        title: 'Yes/No',
        version: null,
        status: 'active',
        immutable: false,
        publisherId: 'pub-loinc',
        category: 'local',
        codeCount: 2,
        primarySystem: 'http://LOINC.org',
      },
    ] as never);
    vi.spyOn(api, 'getValueSet').mockResolvedValue({
      id: 'vs-yn',
      url: 'urn:openldr:vs:yes-no',
      version: null,
      name: 'YesNo',
      title: 'Yes/No',
      status: 'active',
      experimental: false,
      description: null,
      compose: { include: [] },
      immutable: false,
      category: 'local',
      publisherId: 'pub-loinc',
    } as never);
    vi.spyOn(api, 'expandValueSet').mockResolvedValue({ codes: [], total: 0 });

    render(<MemoryRouter><Terminology /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /value sets/i }));
    expect(await screen.findByText('urn:openldr:vs:yes-no')).toBeInTheDocument();
    fireEvent.click(await screen.findByText('Yes/No'));

    await waitFor(() => expect(api.getValueSet).toHaveBeenCalledWith('vs-yn'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('opens ontology browse and distribution dialogs from a ready code-system row', async () => {
    vi.spyOn(api, 'listOntologyDistributions').mockResolvedValue([
      {
        codingSystemId: 'cs1',
        ontologyType: 'loinc',
        sourcePath: 'D:\\terminology\\loinc',
        indexStatus: 'ready',
        indexError: null,
        nodeCount: 10,
        edgeCount: 9,
        builtAt: '2026-06-16T00:00:00.000Z',
        updatedAt: '2026-06-16T00:00:00.000Z',
        stale: false,
      },
    ] as never);

    render(<MemoryRouter><Terminology /></MemoryRouter>);

    const rowActions = (await screen.findAllByRole('button', { name: /actions/i }))[1];
    fireEvent.pointerDown(rowActions, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Ontology')) fireEvent.keyDown(rowActions, { key: 'Enter' });
    fireEvent.pointerMove(await screen.findByText('Ontology'));
    fireEvent.keyDown(await screen.findByText('Ontology'), { key: 'Enter' });
    fireEvent.click(await screen.findByText('Browse'));
    expect(await screen.findByText('Browse mock LOINC')).toBeInTheDocument();

    fireEvent.pointerDown(rowActions, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Ontology')) fireEvent.keyDown(rowActions, { key: 'Enter' });
    fireEvent.pointerMove(await screen.findByText('Ontology'));
    fireEvent.keyDown(await screen.findByText('Ontology'), { key: 'Enter' });
    fireEvent.click(await screen.findByText('Distribution'));
    expect(await screen.findByText('Distribution mock LOINC')).toBeInTheDocument();
  });

  it('imports generic term CSV from a code-system row action', async () => {
    const importSpy = vi.spyOn(api, 'importTerms').mockResolvedValue({ imported: 1 });

    render(<MemoryRouter><Terminology /></MemoryRouter>);

    const rowActions = (await screen.findAllByRole('button', { name: /actions/i }))[1];
    fireEvent.pointerDown(rowActions, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Terms')) fireEvent.keyDown(rowActions, { key: 'Enter' });
    fireEvent.pointerMove(await screen.findByText('Terms'));
    fireEvent.keyDown(await screen.findByText('Terms'), { key: 'Enter' });
    fireEvent.click(await screen.findByText('Import'));

    const input = await screen.findByTestId('term-import-input');
    expect(input).toHaveAttribute('accept', expect.stringContaining('.rrf'));
    expect(input).toHaveAttribute('accept', expect.stringContaining('.jsonl'));
    const file = new File(['code,display,status\nA,Alpha,ACTIVE\n'], 'terms.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(importSpy).toHaveBeenCalledWith('cs1', file));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Imported 1 term(s) into LOINC.'));
    expect(screen.queryByText('Imported 1 term(s) into LOINC.')).not.toBeInTheDocument();
  });

  it('imports a gzipped FHIR ValueSet catalog from the page actions', async () => {
    const importSpy = vi.spyOn(api, 'importValueSet').mockResolvedValue({ imported: 672, skipped: 0, valueSet: null });

    render(<MemoryRouter><Terminology /></MemoryRouter>);

    const pageActions = (await screen.findAllByRole('button', { name: /actions/i }))[0];
    fireEvent.pointerDown(pageActions, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Value set')) fireEvent.keyDown(pageActions, { key: 'Enter' });
    fireEvent.pointerMove(await screen.findByText('Value set'));
    fireEvent.keyDown(await screen.findByText('Value set'), { key: 'Enter' });
    fireEvent.click(await screen.findByText('Import...'));

    const input = await screen.findByTestId('valueset-import-input');
    expect(input).toHaveAttribute('accept', expect.stringContaining('.json.gz'));
    const file = new File(['gz bytes'], 'R4.valuesets.json.gz', { type: 'application/gzip' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(importSpy).toHaveBeenCalledWith(file));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Imported 672 value set(s); skipped 0.'));
    expect(screen.queryByText('Imported 672 value set(s); skipped 0.')).not.toBeInTheDocument();
  });

  it('shows "Import distribution..." on the LOINC publisher menu and uploads the selected file', async () => {
    const uploadSpy = vi.spyOn(api, 'uploadTerminologyDistribution').mockResolvedValue({ jobId: 'tij_1' });
    vi.spyOn(api, 'getTerminologyIngestJob').mockResolvedValue({
      id: 'tij_1', status: 'queued', phase: null, processed: 0, total: null, error: null, version: null, finishedAt: null,
    });

    render(<MemoryRouter><Terminology /></MemoryRouter>);

    const pageActions = (await screen.findAllByRole('button', { name: /actions/i }))[0];
    fireEvent.pointerDown(pageActions, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Import distribution...')) fireEvent.keyDown(pageActions, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Import distribution...'));

    const file = new File([new Uint8Array([1, 2, 3])], 'loinc.zip');
    fireEvent.change(await screen.findByLabelText('Distribution .zip'), { target: { files: [file] } });
    fireEvent.click(await screen.findByLabelText('I have accepted the license for this distribution.'));
    fireEvent.click(await screen.findByRole('button', { name: 'Upload & import' }));

    await waitFor(() => expect(uploadSpy).toHaveBeenCalledWith('pub-loinc', 'loinc', file, true, null, expect.any(Function)));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Import started/)));
    expect(screen.queryByText(/Import started/)).not.toBeInTheDocument();
  });

  it('renders a dropzone with browse copy and shows the chosen file name + size (not a bare file input label)', async () => {
    vi.spyOn(api, 'uploadTerminologyDistribution').mockResolvedValue({ jobId: 'tij_1' });
    render(<MemoryRouter><Terminology /></MemoryRouter>);

    const pageActions = (await screen.findAllByRole('button', { name: /actions/i }))[0];
    fireEvent.pointerDown(pageActions, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Import distribution...')) fireEvent.keyDown(pageActions, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Import distribution...'));

    // The dropzone shows browse copy up front, no file name/size is visible yet.
    expect(await screen.findByText(/Drag a distribution \.zip here, or click to browse/i)).toBeInTheDocument();
    expect(screen.queryByText('loinc.zip')).not.toBeInTheDocument();

    const file = new File([new Uint8Array(2048)], 'loinc.zip');
    fireEvent.change(await screen.findByLabelText('Distribution .zip'), { target: { files: [file] } });

    // Once a file is chosen, the browse copy is replaced by the file's name + human-readable size.
    expect(await screen.findByText('loinc.zip')).toBeInTheDocument();
    expect(await screen.findByText(/2\.0 KB/)).toBeInTheDocument();
    expect(screen.queryByText(/Drag a distribution \.zip here, or click to browse/i)).not.toBeInTheDocument();
  });

  it('shows a live progress bar (not just text) while the upload is in flight', async () => {
    vi.spyOn(api, 'uploadTerminologyDistribution').mockImplementation(
      (_publisherId, _systemType, _file, _accept, _version, onProgress) => {
        onProgress?.(0.5);
        return new Promise(() => { /* never resolves; keeps the dialog "busy" for the assertion */ });
      },
    );

    render(<MemoryRouter><Terminology /></MemoryRouter>);

    const pageActions = (await screen.findAllByRole('button', { name: /actions/i }))[0];
    fireEvent.pointerDown(pageActions, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Import distribution...')) fireEvent.keyDown(pageActions, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Import distribution...'));

    const file = new File([new Uint8Array([1, 2, 3])], 'loinc.zip');
    fireEvent.change(await screen.findByLabelText('Distribution .zip'), { target: { files: [file] } });
    fireEvent.click(await screen.findByLabelText('I have accepted the license for this distribution.'));
    fireEvent.click(await screen.findByRole('button', { name: 'Upload & import' }));

    expect(await screen.findByText('Uploading… 50%')).toBeInTheDocument();
    await waitFor(() => {
      const fill = document.body.querySelector('.bg-muted > .bg-primary') as HTMLElement | null;
      expect(fill).not.toBeNull();
      expect(fill?.style.width).toBe('50%');
    });
  });

  it('enables the publisher-level "Import distribution..." even when no LOINC code system exists yet', async () => {
    vi.spyOn(api, 'listCodingSystems').mockResolvedValue([] as never);
    vi.spyOn(api, 'uploadTerminologyDistribution').mockResolvedValue({ jobId: 'tij_1' });
    render(<MemoryRouter><Terminology /></MemoryRouter>);
    await screen.findByText(/No code systems or value sets yet/i);
    const actions = await screen.findByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actions, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Import distribution...')) fireEvent.keyDown(actions, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Import distribution...'));
    // Dialog opens now (no coding system required).
    expect(await screen.findByLabelText('Distribution .zip')).toBeInTheDocument();
  });

  it('resumes polling an in-flight distribution import on mount, and refreshes when it completes', async () => {
    // Only one distribution-capable publisher, to keep the mount-resume call sequence unambiguous.
    vi.spyOn(api, 'listPublishers').mockResolvedValue([pub('pub-loinc', 'LOINC')] as never);
    const distSpy = vi.spyOn(api, 'listOntologyDistributions').mockReset().mockResolvedValue([]);
    const getJob = vi.spyOn(api, 'getTerminologyIngestJob').mockReset();
    // First call (mount-resume check) finds the job still running; every call after that
    // (the resumed poll's checks) reports it as ready.
    getJob.mockResolvedValueOnce({
      id: 'tij_1', status: 'running', phase: null, processed: 10, total: 100, error: null, version: null, finishedAt: null,
    });
    getJob.mockResolvedValue({
      id: 'tij_1', status: 'ready', phase: null, processed: 100, total: 100, error: null, version: null, finishedAt: null,
    });

    render(<MemoryRouter><Terminology /></MemoryRouter>);

    // Mount resumed polling for the still-in-flight LOINC import (no import was queued this session).
    await waitFor(() => expect(getJob).toHaveBeenCalledWith('pub-loinc', 'loinc'));

    // The resumed poll's next check sees 'ready' and reload() refetches distributions again,
    // so the ontology menu un-stales itself even though the page was freshly mounted.
    await waitFor(() => expect(distSpy.mock.calls.length).toBeGreaterThan(1));
  });

  it('shows "Import distribution..." on the SNOMED CT publisher menu and uploads with systemType=snomed', async () => {
    const uploadSpy = vi.spyOn(api, 'uploadTerminologyDistribution').mockResolvedValue({ jobId: 'tij_1' });
    vi.spyOn(api, 'getTerminologyIngestJob').mockResolvedValue({
      id: 'tij_1', status: 'queued', phase: null, processed: 0, total: null, error: null, version: null, finishedAt: null,
    });

    render(<MemoryRouter><Terminology /></MemoryRouter>);

    fireEvent.click(await screen.findByText('SNOMED CT'));
    await screen.findByText(/No code systems or value sets yet/i);

    const actions = await screen.findByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actions, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Import distribution...')) fireEvent.keyDown(actions, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Import distribution...'));

    const file = new File([new Uint8Array([1, 2, 3])], 'snomed.zip');
    fireEvent.change(await screen.findByLabelText('Distribution .zip'), { target: { files: [file] } });
    fireEvent.click(await screen.findByLabelText('I have accepted the license for this distribution.'));
    fireEvent.click(await screen.findByRole('button', { name: 'Upload & import' }));

    await waitFor(() => expect(uploadSpy).toHaveBeenCalledWith('pub-snomed-ct', 'snomed', file, true, null, expect.any(Function)));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Import started/)));
    expect(screen.queryByText(/Import started/)).not.toBeInTheDocument();
  });

  it('confirms before deleting a stored distribution, and only purges after typing the name + confirming', async () => {
    const purgeSpy = vi.spyOn(api, 'purgeTerminologyDistribution').mockResolvedValue(undefined as never);

    render(<MemoryRouter><Terminology /></MemoryRouter>);

    // Purge now lives on the system row's ⋯ menu, under a "Delete" submenu → "Stored distribution".
    const allActions = await screen.findAllByRole('button', { name: /actions/i });
    const rowActions = allActions[allActions.length - 1];
    fireEvent.pointerDown(rowActions, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Delete')) fireEvent.keyDown(rowActions, { key: 'Enter' });
    fireEvent.pointerMove(await screen.findByText('Delete'));
    fireEvent.keyDown(await screen.findByText('Delete'), { key: 'Enter' });
    fireEvent.click(await screen.findByText('Distribution'));

    // Confirm dialog is up; the destructive action must NOT have fired yet.
    await screen.findByRole('alertdialog');
    expect(purgeSpy).not.toHaveBeenCalled();

    // The Delete button stays disabled until the publisher name is typed exactly.
    const deleteButton = await screen.findByRole('button', { name: 'Delete' });
    expect(deleteButton).toBeDisabled();
    fireEvent.click(deleteButton);
    expect(purgeSpy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Confirm name'), { target: { value: 'LOINC' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(purgeSpy).toHaveBeenCalledWith('pub-loinc', 'loinc'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Stored distribution deleted.'));
    expect(screen.queryByText('Stored distribution deleted.')).not.toBeInTheDocument();
  });

  it('starting a distribution import fires exactly one start toast and renders no inline banner', async () => {
    const uploadSpy = vi.spyOn(api, 'uploadTerminologyDistribution').mockResolvedValue({ jobId: 'tij_1' });
    vi.spyOn(api, 'getTerminologyIngestJob').mockResolvedValue({
      id: 'tij_1', status: 'queued', phase: null, processed: 0, total: null, error: null, version: null, finishedAt: null,
    });

    render(<MemoryRouter><Terminology /></MemoryRouter>);

    const pageActions = (await screen.findAllByRole('button', { name: /actions/i }))[0];
    fireEvent.pointerDown(pageActions, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Import distribution...')) fireEvent.keyDown(pageActions, { key: 'Enter' });
    fireEvent.click(await screen.findByText('Import distribution...'));

    const file = new File([new Uint8Array([1, 2, 3])], 'loinc.zip');
    fireEvent.change(await screen.findByLabelText('Distribution .zip'), { target: { files: [file] } });
    fireEvent.click(await screen.findByLabelText('I have accepted the license for this distribution.'));
    fireEvent.click(await screen.findByRole('button', { name: 'Upload & import' }));

    await waitFor(() => expect(uploadSpy).toHaveBeenCalled());
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("Import started — you’ll be notified when it completes.");
    expect(toast.error).not.toHaveBeenCalled();
    // No inline banner — the message only ever reaches the mocked sonner toast, never the DOM.
    expect(screen.queryByText(/Import started/)).not.toBeInTheDocument();
  });
});
