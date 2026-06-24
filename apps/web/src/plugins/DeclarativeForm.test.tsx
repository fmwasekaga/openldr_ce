import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';
import { DeclarativeForm } from './DeclarativeForm';
import * as api from '@/api';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, pluginBrokerCall: vi.fn() };
});

const schema = { type: 'object', properties: {
  baseUrl: { type: 'string', title: 'Base URL' },
  retries: { type: 'number', title: 'Retries' },
  enabled: { type: 'boolean', title: 'Enabled' },
} };

describe('DeclarativeForm', () => {
  beforeEach(() => {
    (api.pluginBrokerCall as any).mockReset();
    (api.pluginBrokerCall as any).mockResolvedValueOnce({ ok: true, data: { baseUrl: 'https://x', retries: 2, enabled: true } }); // initial load
  });

  it('renders fields from the schema and saves edited values via the broker', async () => {
    (api.pluginBrokerCall as any).mockResolvedValue({ ok: true, data: null }); // subsequent put
    render(<DeclarativeForm pluginId="cfg" schema={schema} />);
    const url = await screen.findByLabelText('Base URL') as HTMLInputElement;
    expect(url.value).toBe('https://x');
    fireEvent.change(url, { target: { value: 'https://y' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      const putCall = (api.pluginBrokerCall as any).mock.calls.find((c: any) => c[1]?.kind === 'storage.put');
      expect(putCall[1]).toMatchObject({ kind: 'storage.put', collection: 'config', key: 'declarative', doc: { baseUrl: 'https://y', retries: 2, enabled: true } });
    });
  });
});
