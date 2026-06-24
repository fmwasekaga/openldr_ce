import { readGrant, type Capability } from '@openldr/marketplace';
import type { PluginDataStore } from '@openldr/db';
import type { PluginPolicy } from './policy';
import { policyAllows } from './policy';

/** The caller principal (the authenticated host user forwarding on the plugin's behalf). */
export interface BrokerPrincipal {
  id: string;
  roles: string[];
}

/** Operations a plugin UI may request. storage.* is private (namespaced by the trusted
 *  pluginId); invoke runs the plugin's own wasm; the rest are gated host ops. */
export type BrokerOp =
  | { kind: 'storage.get'; collection: string; key: string }
  | { kind: 'storage.put'; collection: string; key: string; doc: unknown }
  | { kind: 'storage.delete'; collection: string; key: string }
  | { kind: 'storage.list'; collection: string; where?: { field: string; eq: unknown }; limit?: number }
  | { kind: 'invoke'; entrypoint: string; input: unknown }
  | { kind: 'reports.list' }
  | { kind: 'reports.columns'; id: string }
  | { kind: 'reports.run'; id: string; params?: Record<string, unknown> }
  | { kind: 'connectors.list' }
  | { kind: 'connectors.test'; id: string };

export type BrokerResult = { ok: true; data: unknown } | { ok: false; error: string };

/** Maps an op to the capability it requires (undefined = private/no capability). */
function gateFor(op: BrokerOp): string | undefined {
  switch (op.kind) {
    case 'reports.list': case 'reports.columns': case 'reports.run': return 'host:reports';
    case 'connectors.list': case 'connectors.test': return 'host:connectors';
    default: return undefined; // storage.*, invoke
  }
}

export interface PluginBrokerDeps {
  plugins: {
    list(): Promise<Array<{ id: string; version: string; enabled: boolean; manifest: Record<string, unknown> }>>;
    loadSink(id: string, version?: string): Promise<{ invoke(entrypoint: string, input: unknown, opts?: unknown): Promise<unknown> } | undefined>;
  };
  pluginData: PluginDataStore;
  reporting: { list(): unknown; columns?(id: string): unknown; run(id: string, params: unknown): Promise<unknown> };
  connectors: { list(): Promise<unknown[]>; get(id: string): Promise<unknown | null> };
  /** Test a connector live (resolve→loadSink→health/metadata). Optional here; wired in app
   *  context. When absent, connectors.test returns a structured error. */
  testConnector?: (id: string) => Promise<unknown>;
  policy: () => PluginPolicy;
}

export interface PluginBroker {
  handle(pluginId: string, principal: BrokerPrincipal, op: BrokerOp): Promise<BrokerResult>;
}

export function createPluginBroker(deps: PluginBrokerDeps): PluginBroker {
  function hasCapability(caps: Capability[], gate: string): boolean {
    return caps.some((c) => c.kind === gate);
  }

  return {
    async handle(pluginId, _principal, op) {
      try {
        // 1. Plugin must be installed + enabled.
        const rows = await deps.plugins.list();
        const row = rows.find((r) => r.id === pluginId && r.enabled);
        if (!row) return { ok: false, error: `plugin ${pluginId} is not installed or disabled` };

        // 2. Global policy (kill-switches) — checked on EVERY call.
        const gate = gateFor(op);
        if (!policyAllows(deps.policy(), gate)) {
          return { ok: false, error: `operation ${op.kind} is disabled by global policy` };
        }

        // 3. Capability grant. Legacy rows (no capabilities field) are grandfathered.
        if (gate) {
          const grant = readGrant(row.manifest);
          if (!grant.legacy && !hasCapability(grant.capabilities, gate)) {
            return { ok: false, error: `operation ${op.kind} requires the ${gate} capability, which plugin ${pluginId} was not granted` };
          }
        }

        // 4. Dispatch. Storage is namespaced by the trusted pluginId argument.
        switch (op.kind) {
          case 'storage.get': return { ok: true, data: await deps.pluginData.get(pluginId, op.collection, op.key) };
          case 'storage.put': await deps.pluginData.put(pluginId, op.collection, op.key, op.doc); return { ok: true, data: null };
          case 'storage.delete': await deps.pluginData.delete(pluginId, op.collection, op.key); return { ok: true, data: null };
          case 'storage.list': return { ok: true, data: await deps.pluginData.list(pluginId, op.collection, { where: op.where, limit: op.limit }) };
          case 'invoke': {
            const sink = await deps.plugins.loadSink(pluginId, row.version);
            if (!sink) return { ok: false, error: `plugin ${pluginId} exposes no invokable wasm` };
            return { ok: true, data: await sink.invoke(op.entrypoint, op.input) };
          }
          case 'reports.list': return { ok: true, data: deps.reporting.list() };
          case 'reports.columns': {
            if (!deps.reporting.columns) return { ok: false, error: 'reports.columns is unavailable' };
            return { ok: true, data: deps.reporting.columns(op.id) };
          }
          case 'reports.run': return { ok: true, data: await deps.reporting.run(op.id, op.params ?? {}) };
          case 'connectors.list': return { ok: true, data: await deps.connectors.list() };
          case 'connectors.test': {
            if (!deps.testConnector) return { ok: false, error: 'connectors.test is unavailable' };
            return { ok: true, data: await deps.testConnector(op.id) };
          }
          default: return { ok: false, error: `unknown operation` };
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
