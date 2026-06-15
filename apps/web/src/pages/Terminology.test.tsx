import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
});
