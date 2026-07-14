import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { WebhookForm } from './webhook-form';
import { HttpRequestForm } from './http-request-form';

// Radix Select is awkward in jsdom; render it as a native <select> for these tests.
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value?: string; onValueChange?: (v: string) => void }) => (
    <select role="combobox" value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)}>{children}</select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

const REF = { secretRef: 'wsec_abc123' };

describe('WebhookForm — write-only secret (SEC-06)', () => {
  it('renders a masked state for a saved {secretRef} and never overwrites it', () => {
    const update = vi.fn();
    const node = { id: 'w', type: 'webhook', data: { label: 'hook', path: 'p', method: 'POST', secret: REF } } as never;
    const { getByPlaceholderText } = render(<WebhookForm node={node} update={update} />);
    // Masked placeholder shown; the opaque ref value is never rendered.
    expect(getByPlaceholderText(/secret is set/i)).toBeInTheDocument();
    // The seed-on-mount effect must NOT clobber the saved ref with a new plaintext.
    expect(update).not.toHaveBeenCalled();
  });

  it('replaces the secret with a plaintext string when "Replace secret" is clicked', () => {
    const update = vi.fn();
    const node = { id: 'w', type: 'webhook', data: { label: 'hook', path: 'p', method: 'POST', secret: REF } } as never;
    const { getByText } = render(<WebhookForm node={node} update={update} />);
    fireEvent.click(getByText(/replace secret/i));
    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0][0] as { secret: unknown };
    expect(typeof arg.secret).toBe('string');
    expect(arg.secret).not.toEqual(REF);
  });

  it('seeds a plaintext secret on mount when none is set', () => {
    const update = vi.fn();
    const node = { id: 'w', type: 'webhook', data: { label: 'hook', path: 'p', method: 'POST' } } as never;
    render(<WebhookForm node={node} update={update} />);
    expect(update).toHaveBeenCalledTimes(1);
    expect(typeof (update.mock.calls[0][0] as { secret: unknown }).secret).toBe('string');
  });
});

describe('HttpRequestForm — write-only headers blob (SEC-06)', () => {
  const node = (headers: unknown) =>
    ({ id: 'h', type: 'action', data: { label: 'http', action: 'http-request', config: { method: 'GET', headers } } } as never);

  it('masks a {secretRef} headers blob (no textarea, shows hidden notice)', () => {
    const update = vi.fn();
    const { getByText, queryByPlaceholderText } = render(<HttpRequestForm node={node(REF)} update={update} />);
    expect(getByText(/headers contain a secret/i)).toBeInTheDocument();
    // The normal headers textarea must not render while the blob is a ref.
    expect(queryByPlaceholderText(/content-type/i)).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('replaces the whole blob with an empty string when "Replace headers" is clicked', () => {
    const update = vi.fn();
    const { getByText } = render(<HttpRequestForm node={node(REF)} update={update} />);
    fireEvent.click(getByText(/replace headers/i));
    expect(update).toHaveBeenCalledWith({ config: expect.objectContaining({ headers: '' }) });
  });

  it('renders the normal textarea for a plain-string headers blob', () => {
    const update = vi.fn();
    const { getByPlaceholderText } = render(<HttpRequestForm node={node('{ "X-Foo": "1" }')} update={update} />);
    const ta = getByPlaceholderText(/content-type/i);
    fireEvent.change(ta, { target: { value: '{ "A": "b" }' } });
    expect(update).toHaveBeenCalledWith({ config: expect.objectContaining({ headers: '{ "A": "b" }' }) });
  });
});
