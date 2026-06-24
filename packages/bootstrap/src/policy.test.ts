import { describe, it, expect } from 'vitest';
import { policyFromConfig, policyAllows } from './policy';

describe('plugin policy', () => {
  it('derives the policy from config flags', () => {
    expect(policyFromConfig({ PLUGIN_UI_ENABLED: true, PLUGIN_EGRESS_ENABLED: false } as any))
      .toEqual({ uiEnabled: true, egressEnabled: false });
  });

  it('policyAllows: ui gate blocks everything when uiEnabled is false', () => {
    const p = { uiEnabled: false, egressEnabled: true };
    expect(policyAllows(p, 'host:reports')).toBe(false);
    expect(policyAllows(p, undefined)).toBe(false); // private storage call also blocked
  });

  it('policyAllows: egress gate only affects net-egress', () => {
    const p = { uiEnabled: true, egressEnabled: false };
    expect(policyAllows(p, 'host:reports')).toBe(true);
    expect(policyAllows(p, 'net-egress')).toBe(false);
  });

  it('policyAllows: all-on permits every gate', () => {
    const p = { uiEnabled: true, egressEnabled: true };
    expect(policyAllows(p, undefined)).toBe(true);
    expect(policyAllows(p, 'net-egress')).toBe(true);
    expect(policyAllows(p, 'host:connectors')).toBe(true);
  });
});
