import { readGrant, type Grant } from '@openldr/marketplace';

/** A node's declared capability kinds must be a subset of the plugin's grant. Legacy (pre-capability)
 *  rows are grandfathered — same posture as the SP-1 registry and the broker. */
export function capsSubset(nodeCaps: string[], grant: Grant): boolean {
  if (grant.legacy) return true;
  const granted = new Set<string>(grant.capabilities.map((c) => c.kind));
  return nodeCaps.every((c) => granted.has(c));
}

/** Re-enforce a workflow node's declared capabilities at execution (defense in depth vs the SP-1
 *  discovery-time check). Egress is gated only by the egress kill-switch — workflow nodes are NOT
 *  coupled to the plugin-UI master switch. Throws fail-closed. */
export function assertNodeAllowed(
  decl: { id: string; capabilities: string[] },
  row: { id: string; enabled: boolean; manifest: Record<string, unknown> },
  policy: { egressEnabled: boolean },
): void {
  if (!row.enabled) throw new Error(`plugin ${row.id} is not enabled`);
  const grant = readGrant(row.manifest);
  if (!capsSubset(decl.capabilities, grant)) {
    throw new Error(`node ${row.id}:${decl.id} declares capabilities exceeding the plugin grant`);
  }
  if (decl.capabilities.includes('net-egress') && !policy.egressEnabled) {
    throw new Error(`node ${row.id}:${decl.id} requires egress, which is disabled by the kill-switch`);
  }
}
