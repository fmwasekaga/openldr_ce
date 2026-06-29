import { describe, it, expect } from 'vitest';
import { assertNodeAllowed, capsSubset } from './plugin-node-policy';
import type { Grant } from '@openldr/marketplace';

const row = (caps: unknown, enabled = true) => ({
  id: 'p', enabled,
  manifest: { capabilities: caps } as Record<string, unknown>,
});
const decl = (capabilities: string[]) => ({ id: 'n', capabilities });

describe('capsSubset', () => {
  it('allows when legacy', () => {
    expect(capsSubset(['net-egress'], { legacy: true } as Grant)).toBe(true);
  });
  it('allows a subset and rejects a superset', () => {
    const g: Grant = { legacy: false, capabilities: [{ kind: 'host:connectors' }] };
    expect(capsSubset(['host:connectors'], g)).toBe(true);
    expect(capsSubset(['host:connectors', 'net-egress'], g)).toBe(false);
  });
});

describe('assertNodeAllowed', () => {
  it('passes when caps ⊆ grant and egress not involved', () => {
    expect(() => assertNodeAllowed(decl(['host:connectors']), row([{ kind: 'host:connectors' }]), { egressEnabled: true })).not.toThrow();
  });
  it('throws when the plugin is disabled', () => {
    expect(() => assertNodeAllowed(decl([]), row([], false), { egressEnabled: true })).toThrow(/not enabled/i);
  });
  it('throws when a node capability exceeds the grant', () => {
    expect(() => assertNodeAllowed(decl(['net-egress']), row([]), { egressEnabled: true })).toThrow(/exceed/i);
  });
  it('throws when net-egress is declared but the egress kill-switch is off', () => {
    expect(() => assertNodeAllowed(decl(['net-egress']), row([{ kind: 'net-egress', allowedHosts: [] }]), { egressEnabled: false }))
      .toThrow(/egress/i);
  });
  it('grandfathers a legacy plugin (no capabilities field)', () => {
    const r = { id: 'p', enabled: true, manifest: {} as Record<string, unknown> };
    expect(() => assertNodeAllowed(decl(['net-egress']), r, { egressEnabled: true })).not.toThrow();
  });
});
