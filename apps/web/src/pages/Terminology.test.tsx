import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Terminology } from './Terminology';
import * as api from '../api';

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
    vi.spyOn(api, 'listPublishers').mockResolvedValue([
      pub('pub-loinc', 'LOINC'),
      pub('pub-snomed-ct', 'SNOMED CT'),
    ] as never);
    vi.spyOn(api, 'listCodingSystems').mockResolvedValue([
      sys('cs1', 'LOINC', 'pub-loinc'),
    ] as never);
    vi.spyOn(api, 'listValueSets').mockResolvedValue([] as never);
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
    expect(screen.getByText('urn:openldr:vs:yes-no')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Yes/No'));

    await waitFor(() => expect(api.getValueSet).toHaveBeenCalledWith('vs-yn'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
