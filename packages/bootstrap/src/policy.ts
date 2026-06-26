import type { Config } from '@openldr/config';

/** Runtime global policy for the plugin-UI surface, derived from config kill-switches.
 *  The broker checks this on EVERY call, independent of (and stricter than) any grant. */
export interface PluginPolicy {
  uiEnabled: boolean;
  egressEnabled: boolean;
}

export function policyFromConfig(cfg: Config): PluginPolicy {
  return { uiEnabled: cfg.PLUGIN_UI_ENABLED, egressEnabled: cfg.PLUGIN_EGRESS_ENABLED };
}

/** Does the current policy permit an operation requiring `gate`?
 *  `gate` is the capability the operation maps to (or undefined for private ops like storage).
 *  - uiEnabled=false → nothing is allowed (master kill-switch).
 *  - egressEnabled=false → net-egress operations are refused regardless of grant.
 *  - everything else is policy-allowed (the grant check is separate, in the broker).
 *
 *  NOTE: the connector broker ops that actually egress (connectors.test/metadata/push/validate)
 *  gate to the `host:connectors` capability, NOT `net-egress`, so this function does NOT cover
 *  them. The egress kill-switch is enforced for those ops at the OP level in the broker's
 *  `handle` (see `egresses()` in plugin-broker.ts), so PLUGIN_EGRESS_ENABLED=false blocks them. */
export function policyAllows(policy: PluginPolicy, gate: string | undefined): boolean {
  if (!policy.uiEnabled) return false;
  if (gate === 'net-egress' && !policy.egressEnabled) return false;
  return true;
}
