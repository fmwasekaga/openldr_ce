import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../api';
import { OntologyBrowser } from './OntologyBrowser';

const root = {
  code: 'LP29684-5',
  display: 'Laboratory',
  kind: 'class',
  extra: null,
  childCount: 1,
  group: null,
};

const child = {
  code: '718-7',
  display: 'Hemoglobin [Mass/volume] in Blood',
  kind: 'term',
  extra: { property: 'MCnc' },
  childCount: 0,
  group: null,
};

describe('OntologyBrowser', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loads roots, lazily expands children, shows detail, and supports picker mode', async () => {
    vi.spyOn(api, 'ontologyRoots').mockResolvedValue([root]);
    vi.spyOn(api, 'ontologyChildren').mockResolvedValue([child]);
    vi.spyOn(api, 'ontologyNodeDetail').mockResolvedValue(child);
    const onPick = vi.fn();

    render(
      <OntologyBrowser
        codingSystemId="loinc"
        systemName="LOINC"
        ontologyType="loinc"
        mode="picker"
        onPick={onPick}
      />,
    );

    expect(await screen.findByText('Laboratory')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Laboratory').closest('button')!.querySelector('span')!);

    expect(await screen.findByText('Hemoglobin [Mass/volume] in Blood')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Hemoglobin [Mass/volume] in Blood'));

    await waitFor(() => expect(api.ontologyNodeDetail).toHaveBeenCalledWith('loinc', '718-7'));
    expect(await screen.findByText('property')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /use as target/i }));

    expect(api.ontologyChildren).toHaveBeenCalledWith('loinc', 'LP29684-5');
    expect(onPick).toHaveBeenCalledWith({ code: '718-7', display: 'Hemoglobin [Mass/volume] in Blood' });
  });
});
