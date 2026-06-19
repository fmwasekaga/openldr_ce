import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormRuntime } from './FormRuntime';
import type { RuntimeFormSchema } from './types';

const form: RuntimeFormSchema = {
  id: 'f',
  name: 'F',
  title: { en: 'F' },
  sections: [{
    id: 'main',
    title: { en: 'Main' },
    fields: [
      { id: 'patientId', type: 'string', label: { en: 'Patient ID' }, required: true },
      { id: 'hasNotes', type: 'boolean', label: { en: 'Add notes?' } },
      { id: 'notes', type: 'text', label: { en: 'Notes' }, visibility: { whenField: 'hasNotes', equals: true } },
    ],
  }],
};

describe('FormRuntime', () => {
  it('renders fields, applies visibility, and submits cleaned answers', async () => {
    const onSubmit = vi.fn();
    render(<FormRuntime schema={form} submitLabel="Submit" onSubmit={onSubmit} />);
    expect(screen.getByLabelText('Patient ID')).toBeInTheDocument();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Patient ID'), { target: { value: 'P-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add notes?' }));
    expect(await screen.findByLabelText('Notes')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Visible note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'P-1', hasNotes: true, notes: 'Visible note' }));
  });
});
