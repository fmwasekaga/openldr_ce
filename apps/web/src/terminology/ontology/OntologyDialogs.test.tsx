import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../api';
import { OntologyDistributionDialog } from './OntologyDistributionDialog';
import { OntologyPickerDialog } from './OntologyPickerDialog';

vi.mock('./OntologyBrowser', () => ({
  OntologyBrowser: ({ onPick }: { onPick?: (node: { code: string; display: string }) => void }) => (
    <button type="button" onClick={() => onPick?.({ code: '718-7', display: 'Hemoglobin' })}>
      Pick Hemoglobin
    </button>
  ),
}));

describe('ontology dialogs', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('closes the picker sheet after a node is picked', async () => {
    const onOpenChange = vi.fn();
    const onPick = vi.fn();

    render(
      <OntologyPickerDialog
        open
        onOpenChange={onOpenChange}
        codingSystemId="loinc"
        systemName="LOINC"
        ontologyType="loinc"
        onPick={onPick}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /pick hemoglobin/i }));

    expect(onPick).toHaveBeenCalledWith({ code: '718-7', display: 'Hemoglobin' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('builds an ontology distribution from a server-side path and reloads status', async () => {
    const ready = {
      codingSystemId: 'loinc',
      ontologyType: 'loinc' as const,
      sourcePath: 'D:\\terminology\\loinc',
      indexStatus: 'ready',
      indexError: null,
      nodeCount: 12,
      edgeCount: 11,
      builtAt: '2026-06-16T00:00:00.000Z',
      updatedAt: '2026-06-16T00:00:00.000Z',
      stale: false,
    };
    vi.spyOn(api, 'getOntologyDistribution').mockResolvedValueOnce(null).mockResolvedValueOnce(ready);
    vi.spyOn(api, 'buildOntology').mockImplementation((_id, _opts, onProgress) => {
      onProgress({ codingSystemId: 'loinc', phase: 'nodes', processed: 2, total: 12 });
      return { promise: Promise.resolve(ready), cancel: vi.fn() };
    });
    const onChanged = vi.fn();

    render(
      <OntologyDistributionDialog
        open
        onOpenChange={vi.fn()}
        codingSystemId="loinc"
        systemName="LOINC"
        onChanged={onChanged}
      />,
    );

    fireEvent.change(await screen.findByLabelText(/server path/i), { target: { value: 'D:\\terminology\\loinc' } });
    fireEvent.click(screen.getByRole('button', { name: /^build$/i }));

    await waitFor(() => expect(api.buildOntology).toHaveBeenCalledWith('loinc', { path: 'D:\\terminology\\loinc' }, expect.any(Function)));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText('12')).toBeInTheDocument();
  });
});
