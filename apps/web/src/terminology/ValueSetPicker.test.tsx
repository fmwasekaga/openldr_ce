import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ValueSetPicker } from './ValueSetPicker';
import * as api from '../api';
import type { ValueSetSummary } from '../api';

const yn: ValueSetSummary = {
  id: 'vs-yn',
  url: 'urn:openldr:vs:yes-no',
  name: 'YesNo',
  title: 'Yes/No',
  version: '1',
  status: 'active',
  immutable: false,
  publisherId: 'pub-local',
  category: null,
  codeCount: 2,
  primarySystem: 'urn:openldr:cs:local',
};

const specimen: ValueSetSummary = {
  id: 'vs-specimen',
  url: 'urn:openldr:vs:specimen-type',
  name: 'SpecimenType',
  title: 'Specimen Type',
  version: null,
  status: 'active',
  immutable: false,
  publisherId: 'pub-local',
  category: 'laboratory',
  codeCount: 4,
  primarySystem: 'urn:openldr:cs:local',
};

describe('ValueSetPicker', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loads value sets once, filters locally, and picks a result', async () => {
    vi.spyOn(api, 'listValueSets').mockResolvedValue([yn, specimen]);
    const onPick = vi.fn();
    render(<ValueSetPicker onPick={onPick} placeholder="Find value set" />);

    fireEvent.focus(screen.getByRole('textbox', { name: /find value set/i }));
    expect(await screen.findByText('Yes/No')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: /find value set/i }), { target: { value: 'spec' } });
    expect(screen.queryByText('Yes/No')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText('Specimen Type'));

    expect(api.listValueSets).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'vs-specimen' }));
    expect(screen.getByRole('textbox', { name: /find value set/i })).toHaveValue('');
  });
});
