import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getAvailableArtifact: vi.fn() };
});
import * as api from '@/api';
import { PackageDetail } from './PackageDetail';
import type { CardEntry } from './util';

const entry: CardEntry = {
  ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.1.0', type: 'plugin',
  publisher: { id: 'p', name: 'OpenLDR Reference' },
  capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }], valid: true,
};

beforeEach(() => { vi.clearAllMocks(); });

function mockDetail(over: Partial<api.AvailableArtifactDetail> = {}) {
  (api.getAvailableArtifact as any).mockResolvedValue({
    ref: 'whonet-narrow', id: 'whonet-sqlite', version: '1.1.0', type: 'plugin',
    description: 'Converts WHONET SQLite to FHIR.', license: 'Apache-2.0',
    publisher: { id: 'p', name: 'OpenLDR Reference' },
    capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
    compatibility: { ceVersion: '*' }, compatible: true, ceVersion: '0.1.0',
    payload: { kind: 'plugin', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), wasi: true, limits: { memoryMb: 256, timeoutMs: 30000 } },
    valid: true, ...over,
  });
}

describe('PackageDetail', () => {
  it('fetches and renders description, permissions and requirements', async () => {
    mockDetail();
    render(<PackageDetail entry={entry} onBack={() => {}} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    expect(await screen.findByText(/Converts WHONET SQLite/)).toBeTruthy();
    expect(screen.getByText(/emit-fhir/)).toBeTruthy();
    expect(screen.getByText(/Compatible with CE/)).toBeTruthy();
  });

  it('Install calls onInstall with the fetched capabilities', async () => {
    mockDetail();
    const onInstall = vi.fn();
    render(<PackageDetail entry={entry} onBack={() => {}} onInstall={onInstall} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    fireEvent.click(await screen.findByTestId('detail-install'));
    await waitFor(() => expect(onInstall).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'whonet-narrow' }),
      [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
    ));
  });

  it('acknowledges the DETAIL capabilities even when the list entry carries none', async () => {
    // Regression: the registry LIST endpoint omits capabilities, so a real Browse entry
    // arrives with capabilities: []. Install must wait for the signed DETAIL and acknowledge
    // its real capability set — otherwise the server rejects (acknowledged != requested).
    mockDetail({ capabilities: [
      { kind: 'emit-fhir', resourceTypes: ['Patient', 'Specimen', 'Observation', 'DiagnosticReport', 'ServiceRequest'] },
      { kind: 'net-egress', allowedHosts: [] },
    ] });
    const listEntry: CardEntry = { ...entry, capabilities: [] };
    const onInstall = vi.fn();
    render(<PackageDetail entry={listEntry} onBack={() => {}} onInstall={onInstall} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    // The consent trigger surfaces the REAL capabilities, not "none".
    const btn = await screen.findByTestId('detail-install');
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(screen.getByText(/emit-fhir/)).toBeTruthy();
    expect(screen.getByText(/net-egress/)).toBeTruthy();
    fireEvent.click(btn);
    await waitFor(() => expect(onInstall).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'whonet-narrow' }),
      [
        { kind: 'emit-fhir', resourceTypes: ['Patient', 'Specimen', 'Observation', 'DiagnosticReport', 'ServiceRequest'] },
        { kind: 'net-egress', allowedHosts: [] },
      ],
    ));
  });

  it('Back calls onBack', async () => {
    mockDetail();
    const onBack = vi.fn();
    render(<PackageDetail entry={entry} onBack={onBack} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    fireEvent.click(await screen.findByTestId('detail-back'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('renders the readme docs section when present', async () => {
    mockDetail({ readme: '# Setup\n\nstep one' });
    render(<PackageDetail entry={entry} onBack={() => {}} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    expect(await screen.findByText('Setup')).toBeTruthy();
  });

  it('switches version and installs the selected ref', async () => {
    (api.getAvailableArtifact as any).mockImplementation((ref: string) =>
      Promise.resolve({ ref, id: 'whonet-sqlite', version: ref === 'whonet-narrow' ? '1.0.0' : '1.1.0', type: 'plugin', publisher: { id: 'p', name: 'P' }, capabilities: [], compatibility: { ceVersion: '*' }, compatible: true, ceVersion: '0.1.0', payload: { kind: 'plugin', entrypoint: 'convert', wasmSha256: 'a'.repeat(64), wasi: true, limits: { memoryMb: 256, timeoutMs: 30000 } }, valid: true }));
    const onInstall = vi.fn();
    const versioned = { ref: 'whonet-wide', id: 'whonet-sqlite', version: '1.1.0', type: 'plugin', publisher: { id: 'p', name: 'P' }, capabilities: [], valid: true, installed: false, versions: [{ version: '1.1.0', ref: 'whonet-wide' }, { version: '1.0.0', ref: 'whonet-narrow' }] };
    render(<PackageDetail entry={versioned as any} onBack={vi.fn()} onInstall={onInstall} onToggleEnabled={vi.fn()} onRollback={vi.fn()} onRemove={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('version-select'));
    fireEvent.click(await screen.findByRole('option', { name: '1.0.0' }));
    await waitFor(() => expect(api.getAvailableArtifact).toHaveBeenCalledWith('whonet-narrow'));
    fireEvent.click(await screen.findByTestId('detail-install'));
    expect(onInstall).toHaveBeenCalledWith(expect.objectContaining({ ref: 'whonet-narrow' }), expect.anything());
  });

  it('installed item shows the actions menu instead of Install', async () => {
    const installedEntry: CardEntry = { ...entry, ref: undefined, installed: true, active: true, enabled: true };
    render(<PackageDetail entry={installedEntry} onBack={() => {}} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    expect(screen.queryByTestId('detail-install')).toBeNull();
    expect(await screen.findByText(/emit-fhir/)).toBeTruthy();
    expect(screen.getByTestId('detail-menu')).toBeTruthy();
  });
});
