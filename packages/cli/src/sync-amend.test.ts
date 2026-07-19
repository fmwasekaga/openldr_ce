import { describe, it, expect, vi } from 'vitest';

const amend = vi.hoisted(() => vi.fn(async () => ({ version: 2, provenanceId: 'prov-1', siteId: 'lab-a' })));
const close = vi.hoisted(() => vi.fn(async () => {}));
const recordAuditEvent = vi.hoisted(() => vi.fn());

vi.mock('@openldr/bootstrap', () => ({
  createAppContext: async () => ({ fhirStore: { amend }, close }),
  recordAuditEvent,
}));
vi.mock('@openldr/config', () => ({ loadConfig: () => ({}) }));

import { runSyncAmend } from './sync';

describe('runSyncAmend', () => {
  it('calls fhirStore.amend and returns 0 on success', async () => {
    const code = await runSyncAmend({ resourceType: 'Observation', id: 'obs-1', status: 'amended', reason: 'x', json: true });
    expect(code).toBe(0);
    expect(amend).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'Observation', id: 'obs-1', status: 'amended' }));
    expect(close).toHaveBeenCalled();
  });

  it('returns 1 when required options are missing', async () => {
    const code = await runSyncAmend({ resourceType: '', id: '', status: '', json: true });
    expect(code).toBe(1);
  });

  it('passes --activity through to amend', async () => {
    const code = await runSyncAmend({ resourceType: 'ServiceRequest', id: 'sr-1', status: 'completed', activity: 'update', json: true });
    expect(code).toBe(0);
    expect(amend).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'ServiceRequest', id: 'sr-1', status: 'completed', activity: 'update' }));
  });

  it('maps UnsupportedResourceTypeError to a non-zero exit', async () => {
    amend.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'UnsupportedResourceTypeError' }));
    const code = await runSyncAmend({ resourceType: 'Patient', id: 'p-1', status: 'active', json: true });
    expect(code).toBe(1);
  });
});
