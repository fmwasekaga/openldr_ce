import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Audit } from './Audit';
import * as api from '../api';

// The Before/After panels render via a read-only CodeMirror (JsonView -> CodeEditor),
// which is awkward in jsdom. Render it as a plain textarea exposing the value so we can
// still assert the JSON payload is shown. Mirrors run-history-drawer.test.
vi.mock('../workflows/components/node-forms/code-editor', () => ({
  CodeEditor: ({ value }: { value: string }) => <textarea data-testid="json" readOnly value={value} />,
}));

const event = {
  id: 'audit-1',
  occurredAt: '2026-01-01T00:00:00.000Z',
  actorType: 'system' as const,
  actorId: null,
  actorName: 'system',
  action: 'form.create',
  entityType: 'form',
  entityId: 'form-1',
  before: { status: 'draft' },
  after: { status: 'published' },
  metadata: { source: 'test' },
};

describe('Audit page', () => {
  beforeEach(() => {
    vi.spyOn(api, 'queryAudit').mockResolvedValue({ events: [event], total: 1 });
    vi.spyOn(api, 'getAuditEvent').mockResolvedValue(event);
  });

  it('renders audit rows, applies filters, and opens details', async () => {
    render(<MemoryRouter><Audit /></MemoryRouter>);

    expect(await screen.findByText('form.create')).toBeInTheDocument();
    expect(screen.getByText('system')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /filter/i }));
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'user.disable' } });
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => expect(api.queryAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'user.disable', limit: 25, offset: 0 })));

    fireEvent.click(screen.getByText('form-1'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('audit-1')).toBeInTheDocument();
    const jsonPanels = within(dialog).getAllByTestId('json').map((el) => (el as HTMLTextAreaElement).value);
    // Before shows the pre-change state, After shows the post-change state.
    expect(jsonPanels.some((v) => v.includes('"status": "draft"'))).toBe(true);
    expect(jsonPanels.some((v) => v.includes('"status": "published"'))).toBe(true);
  });
});
