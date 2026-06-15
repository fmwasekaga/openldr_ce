import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ValueSetBuilder } from './ValueSetBuilder';
import * as api from '../api';
import type { ValueSet } from '../api';

const saved: ValueSet = {
  id: 'vs-custom',
  url: 'urn:openldr:vs:custom',
  version: null,
  name: null,
  title: 'Custom Set',
  status: 'draft',
  experimental: false,
  description: null,
  compose: { include: [{ concept: [] }] },
  immutable: false,
  category: null,
  publisherId: 'pub-local',
};

describe('ValueSetBuilder', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('saves a new value set and refreshes the expansion preview', async () => {
    vi.spyOn(api, 'listPublishers').mockResolvedValue([{ id: 'pub-local', name: 'Local', role: 'local', icon: null, seeded: true, sortOrder: 0 }] as never);
    vi.spyOn(api, 'listValueSets').mockResolvedValue([]);
    vi.spyOn(api, 'saveValueSet').mockResolvedValue(saved);
    vi.spyOn(api, 'expandValueSet').mockResolvedValue({ codes: [{ system: 'urn:system', code: 'Y', display: 'Yes' }], total: 1 });
    const onSaved = vi.fn();

    render(<ValueSetBuilder valueSet={null} systems={[]} defaultPublisherId="pub-local" onSaved={onSaved} onCancel={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText('urn:openldr:valueset:my-set'), { target: { value: 'urn:openldr:vs:custom' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Custom Set' } });
    const actionsButton = screen.getByRole('button', { name: /actions/i });
    fireEvent.pointerDown(actionsButton, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Save')) {
      fireEvent.keyDown(actionsButton, { key: 'Enter' });
    }
    const saveItem = await screen.findByText('Save');
    fireEvent.pointerMove(saveItem);
    fireEvent.click(saveItem);

    await waitFor(() => expect(api.saveValueSet).toHaveBeenCalledWith(expect.objectContaining({
      url: 'urn:openldr:vs:custom',
      title: 'Custom Set',
      publisherId: 'pub-local',
    })));
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(api.expandValueSet).toHaveBeenCalledWith('vs-custom', true);
    expect(await screen.findByText('Yes')).toBeInTheDocument();
  });
});
