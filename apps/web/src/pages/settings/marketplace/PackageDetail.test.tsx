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

  it('Back calls onBack', async () => {
    mockDetail();
    const onBack = vi.fn();
    render(<PackageDetail entry={entry} onBack={onBack} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    fireEvent.click(await screen.findByTestId('detail-back'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('installed item shows the actions menu instead of Install', async () => {
    const installedEntry: CardEntry = { ...entry, ref: undefined, installed: true, active: true, enabled: true };
    render(<PackageDetail entry={installedEntry} onBack={() => {}} onInstall={() => {}} onToggleEnabled={() => {}} onRollback={() => {}} onRemove={() => {}} />);
    expect(screen.queryByTestId('detail-install')).toBeNull();
    expect(await screen.findByText(/emit-fhir/)).toBeTruthy();
    expect(screen.getByTestId('detail-menu')).toBeTruthy();
  });
});
