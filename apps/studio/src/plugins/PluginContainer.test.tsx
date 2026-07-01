import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@/i18n';
import { PluginContainer } from './PluginContainer';
import * as api from '@/api';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listPluginUis: vi.fn() };
});
vi.mock('./PluginFrame', () => ({ PluginFrame: ({ pluginId }: { pluginId: string }) => <div data-testid="frame">{pluginId}</div> }));
vi.mock('./DeclarativeForm', () => ({ DeclarativeForm: ({ pluginId }: { pluginId: string }) => <div data-testid="declform">{pluginId}</div> }));

function renderAt(id: string) {
  return render(<MemoryRouter initialEntries={[`/x/${id}`]}><Routes><Route path="/x/:pluginId" element={<PluginContainer />} /></Routes></MemoryRouter>);
}

describe('PluginContainer', () => {
  it('renders PluginFrame for a webview plugin', async () => {
    (api.listPluginUis as any).mockResolvedValue([{ id: 'web', version: '1', nav: { label: 'W', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1', hasWebview: true, hasDeclarative: false, declarative: null }]);
    renderAt('web');
    await waitFor(() => expect(screen.getByTestId('frame')).toHaveTextContent('web'));
  });
  it('renders DeclarativeForm for a declarative-only plugin', async () => {
    (api.listPluginUis as any).mockResolvedValue([{ id: 'cfg', version: '1', nav: { label: 'C', icon: 'puzzle', section: 'apps' }, uiSdkVersion: '1', hasWebview: false, hasDeclarative: true, declarative: { type: 'object', properties: {} } }]);
    renderAt('cfg');
    await waitFor(() => expect(screen.getByTestId('declform')).toHaveTextContent('cfg'));
  });
  it('shows not-found for an unknown plugin', async () => {
    (api.listPluginUis as any).mockResolvedValue([]);
    renderAt('ghost');
    await waitFor(() => expect(screen.getByText(/not found|not installed/i)).toBeInTheDocument());
  });
});
